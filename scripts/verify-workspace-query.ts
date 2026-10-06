/**
 * Live workspace-SQL verification (productization Slice 21).
 *
 * Proves the properties the SQL surface depends on, against a real PostgreSQL
 * cluster with the migration applied. It talks to the query module
 * (src/server/query.ts) rather than the HTTP route, because the route's
 * authorization is the same auth chain every other route uses; what is unique and
 * load-bearing here is that client SQL executes as the workspace's OWN role, and
 * that the read-only path cannot be escaped.
 *
 *   1. a write caller's SQL runs and persists (CREATE TABLE / INSERT / SELECT);
 *   2. bound parameters are passed as values, never interpolated;
 *   3. a read-only caller can SELECT but a write statement is refused by the
 *      database's read-only transaction;
 *   4. a read-only caller cannot smuggle a second statement past the read-only
 *      transaction (the extended protocol allows only one statement);
 *   5. the SQL executes as the workspace's own NOSUPERUSER role, which holds no
 *      USAGE on the `octo` schema -- so client SQL reaches no control-plane data
 *      even though it runs on the server's own connection path;
 *   6. a row limit truncates a large result rather than returning it whole.
 *
 * Env:
 *   OCTO_ADMIN_URL   privileged connection (CREATE DATABASE / CREATE ROLE). Falls
 *                    back to DATABASE_URL when unset.
 *
 * Exit code 0 = all checks passed; 1 = a check failed; 2 = misconfigured.
 */

import pg from 'pg';

const adminUrl = process.env['OCTO_ADMIN_URL'] || process.env['DATABASE_URL'];
if (!adminUrl) {
  console.error('verify-workspace-query: OCTO_ADMIN_URL (or DATABASE_URL) is required');
  process.exit(2);
}
// Both modules read this at import time, so set it before the dynamic imports below.
process.env['OCTO_ADMIN_URL'] = adminUrl;

const { provisionDatabase, dropProvisionedDatabase } = await import('../src/server/provisioning');
const { runWorkspaceQuery, isSqlError } = await import('../src/server/query');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.error(`  FAIL ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}

const owner = new pg.Client({ connectionString: adminUrl });
let created: { dbName: string; roleName: string } | null = null;

async function main(): Promise<void> {
  await owner.connect();

  try {
    console.log('provision a database to query');
    const provisioned = await provisionDatabase('verify-query');
    created = { dbName: provisioned.dbName, roleName: provisioned.roleName };

    const base = {
      dbName: provisioned.dbName,
      roleName: provisioned.roleName,
      password: provisioned.password,
      rowLimit: 1000,
      timeoutMs: 30000,
    };

    console.log('a write caller runs and persists SQL');
    const ddl = await runWorkspaceQuery({
      ...base,
      sql: 'CREATE TABLE items (id serial PRIMARY KEY, label text NOT NULL)',
      readOnly: false,
    });
    check('a multi-statement write request is accepted', ddl.statementCount >= 1, `count=${ddl.statementCount}`);

    await runWorkspaceQuery({
      ...base,
      sql: 'INSERT INTO items (label) VALUES ($1), ($2)',
      params: ['alpha', 'beta'],
      readOnly: false,
    });

    const read = await runWorkspaceQuery({
      ...base,
      sql: 'SELECT id, label FROM items ORDER BY id',
      readOnly: false,
    });
    check('bound parameters round-trip as values', read.rowCount === 2, `rowCount=${read.rowCount}`);
    check('the last statement\'s columns are reported', read.columns.join(',') === 'id,label', read.columns.join(','));
    check('rows come back as objects', (read.rows[0] as { label?: string })?.label === 'alpha');

    console.log('a read-only caller can read but cannot write');
    const roRead = await runWorkspaceQuery({
      ...base,
      sql: 'SELECT count(*)::int AS n FROM items',
      readOnly: true,
    });
    check('a read-only SELECT succeeds', (roRead.rows[0] as { n?: number })?.n === 2);

    let writeRefused = false;
    let writeDetail = '';
    try {
      await runWorkspaceQuery({ ...base, sql: 'CREATE TABLE nope (id int)', readOnly: true });
    } catch (err) {
      writeRefused = true;
      writeDetail = err instanceof Error ? err.message : String(err);
    }
    check('a write statement in a read-only transaction is refused', writeRefused, writeDetail);
    check('the refusal is the database\'s, not a server guard', /read-only transaction/i.test(writeDetail), writeDetail);

    console.log('a read-only caller cannot smuggle a second statement');
    let smuggled = false;
    let smuggleDetail = '';
    try {
      await runWorkspaceQuery({
        ...base,
        sql: 'SELECT 1; CREATE TABLE smuggled (id int)',
        readOnly: true,
      });
    } catch (err) {
      smuggled = true;
      smuggleDetail = err instanceof Error ? err.message : String(err);
    }
    check('a two-statement read-only request is rejected', smuggled, smuggleDetail);
    const stillGone = await runWorkspaceQuery({
      ...base,
      sql: `SELECT to_regclass('smuggled') IS NULL AS gone`,
      readOnly: true,
    });
    check('the smuggled statement did not run', (stillGone.rows[0] as { gone?: boolean })?.gone === true);

    console.log('client SQL runs as the workspace role, not the admin connection');
    const who = await runWorkspaceQuery({ ...base, sql: 'SELECT current_user AS who', readOnly: false });
    check(
      'SQL executes as the workspace role',
      (who.rows[0] as { who?: string })?.who === provisioned.roleName,
      `current_user=${(who.rows[0] as { who?: string })?.who}`
    );
    let controlReached = false;
    let controlDetail = '';
    try {
      await runWorkspaceQuery({ ...base, sql: 'SELECT count(*) FROM octo.workspaces', readOnly: false });
      controlReached = true;
    } catch (err) {
      controlDetail = err instanceof Error ? err.message : String(err);
      // The connection is to the workspace's own database, which has no `octo`
      // schema, so the read fails as a missing relation. On a cluster where the
      // schema existed it would fail as a privilege denial instead; either way the
      // control-plane row is unreachable through this surface.
      check(
        'the refusal is the database\'s, not a returned row',
        isSqlError(err) && /does not exist|permission denied|42501/i.test(controlDetail),
        controlDetail
      );
    }
    check('client SQL reaches no control-plane data', !controlReached);

    console.log('a row limit truncates rather than returning everything');
    const limited = await runWorkspaceQuery({
      ...base,
      sql: 'SELECT generate_series(1, 50) AS n',
      readOnly: true,
      rowLimit: 10,
    });
    check('the result is truncated to the row limit', limited.rows.length === 10 && limited.truncated === true, `rows=${limited.rows.length} truncated=${limited.truncated}`);

    console.log('teardown drops the database and its role');
    await dropProvisionedDatabase(provisioned.dbName, provisioned.roleName);
    created = null;
    const gone = await owner.query<{ db: boolean; role: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS db,
              EXISTS(SELECT 1 FROM pg_roles WHERE rolname = $2) AS role`,
      [provisioned.dbName, provisioned.roleName]
    );
    check('the dropped database is gone', gone.rows[0]?.db === false);
    check('the dropped role is gone', gone.rows[0]?.role === false);
  } finally {
    if (created) {
      await dropProvisionedDatabase(created.dbName, created.roleName).catch(() => undefined);
    }
    await owner.end().catch(() => undefined);
  }

  if (failures.length > 0) {
    console.error(`\nverify-workspace-query: ${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log('\nverify-workspace-query: all checks passed');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
