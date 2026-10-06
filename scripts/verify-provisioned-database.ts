/**
 * Live provisioned-database verification (productization Slice 20).
 *
 * Proves the properties the slice's success condition names, directly against a
 * real PostgreSQL cluster with the migration applied:
 *
 *   1. the generated role is NOSUPERUSER / NOCREATEDB / NOCREATEROLE and owns its
 *      own database;
 *   2. the minted credential can connect to its own database and run DDL + DML
 *      (create a table, insert, select) -- the feature -- and, where the cluster
 *      offers pgvector, the database is vector-ready and the credential can query
 *      a vector column without having been able to enable the extension itself;
 *   3. the same credential cannot read or write any control-plane data: it holds
 *      no USAGE on the `octo` schema, so every `octo.*` read and write is refused;
 *   4. it cannot connect to another workspace's provisioned database;
 *   5. dropping the database (what a workspace delete does) removes both the
 *      database and its role from the cluster.
 *
 * It talks to the provisioning module (src/server/provisioning.ts) rather than the
 * HTTP route, because the route's authorization is the same auth chain every other
 * route uses; what is unique and load-bearing here is the DDL and the isolation it
 * produces, which only a real cluster can prove.
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
  console.error('verify-provisioned-database: OCTO_ADMIN_URL (or DATABASE_URL) is required');
  process.exit(2);
}
// The module reads this at import time, so set it before the dynamic import below.
process.env['OCTO_ADMIN_URL'] = adminUrl;

const { provisionDatabase, dropProvisionedDatabase } = await import('../src/server/provisioning');

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

/** Builds a connection string for `dbName` reusing a provisioned credential. */
function withDatabase(connectionString: string, dbName: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${dbName}`;
  return url.toString();
}

async function canConnect(connectionString: string): Promise<{ ok: boolean; detail: string }> {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return { ok: true, detail: '' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  } finally {
    await client.end().catch(() => undefined);
  }
}

const created: { dbName: string; roleName: string }[] = [];

async function main(): Promise<void> {
  await owner.connect();

  try {
    console.log('provision two databases');
    const a = await provisionDatabase('verify-alpha');
    const b = await provisionDatabase('verify-beta');
    created.push({ dbName: a.dbName, roleName: a.roleName }, { dbName: b.dbName, roleName: b.roleName });
    check('provisioned two databases', Boolean(a.dbName && b.dbName));
    check('generated names are distinct', a.dbName !== b.dbName && a.roleName !== b.roleName);
    check('database name is a safe identifier', /^[a-z0-9_]+$/.test(a.dbName) && a.dbName.length <= 63);
    check('role name is a safe identifier', /^[a-z0-9_]+$/.test(a.roleName) && a.roleName.length <= 63);

    console.log('role attributes and ownership');
    const roles = await owner.query<{
      rolname: string;
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
    }>(
      `SELECT rolname, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = ANY($1)`,
      [[a.roleName, b.roleName]]
    );
    check('both roles exist', roles.rows.length === 2);
    for (const role of roles.rows) {
      check(
        `${role.rolname} is NOSUPERUSER / NOCREATEDB / NOCREATEROLE`,
        !role.rolsuper && !role.rolcreatedb && !role.rolcreaterole
      );
    }

    const dbs = await owner.query<{ datname: string; owner: string }>(
      `SELECT d.datname, r.rolname AS owner
       FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba
       WHERE d.datname = ANY($1)`,
      [[a.dbName, b.dbName]]
    );
    check('both databases exist', dbs.rows.length === 2);
    const ownerOfA = dbs.rows.find((row) => row.datname === a.dbName)?.owner;
    check('the provisioned role owns its own database', ownerOfA === a.roleName, `owner=${ownerOfA}`);

    console.log('the credential can use its own database');
    const own = new pg.Client({ connectionString: a.connectionString });
    try {
      await own.connect();
      await own.query('CREATE TABLE items (id serial PRIMARY KEY, label text NOT NULL)');
      await own.query('INSERT INTO items (label) VALUES ($1)', ['hello']);
      const rows = await own.query<{ label: string }>('SELECT label FROM items');
      check('client connected and created a table', true);
      check('client inserted and read back a row', rows.rows[0]?.label === 'hello');

      // pgvector is not a trusted extension, so a NOSUPERUSER role cannot enable it
      // itself; provisioning enables it via the privileged connection. Only assert
      // this where the cluster actually offers the extension (the platform image
      // does; a bare Postgres does not).
      const offered = await owner.query<{ offered: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM pg_available_extensions WHERE name = 'vector') AS offered`
      );
      if (offered.rows[0]?.offered) {
        const installed = await own.query<{ installed: boolean }>(
          `SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') AS installed`
        );
        check('the database is vector-ready without the workspace enabling it', installed.rows[0]?.installed === true);

        await own.query('CREATE TABLE embeddings (id serial PRIMARY KEY, e vector(3))');
        await own.query(`INSERT INTO embeddings (e) VALUES ('[1,2,3]')`);
        const near = await own.query<{ id: number }>(
          `SELECT id FROM embeddings ORDER BY e <-> '[1,2,4]' LIMIT 1`
        );
        check('the credential can query a vector column', near.rows.length === 1);
      }
    } catch (err) {
      check('client connected and created a table', false, err instanceof Error ? err.message : String(err));
      check('client inserted and read back a row', false);
    } finally {
      await own.end().catch(() => undefined);
    }

    console.log('the credential is confined to its own database');
    const controlDb = new URL(adminUrl).pathname.replace(/^\//, '') || 'postgres';
    const controlClient = new pg.Client({
      connectionString: withDatabase(a.connectionString, controlDb),
      connectionTimeoutMillis: 5000,
    });
    try {
      await controlClient.connect();
      // Any role may open a session against the control database (PUBLIC holds
      // CONNECT there), so confinement is proven by privilege, not by refusal to
      // connect: the role must hold no USAGE on the octo schema and must be
      // refused every octo.* read and write.
      const usage = await controlClient.query<{ usage: boolean }>(
        `SELECT has_schema_privilege('octo', 'USAGE') AS usage`
      );
      check(
        'credential has no USAGE on the octo schema',
        usage.rows[0]?.usage === false,
        `usage=${usage.rows[0]?.usage}`
      );

      let readDenied = false;
      let readDetail = '';
      try {
        await controlClient.query('SELECT count(*) FROM octo.workspaces');
      } catch (err) {
        readDenied = true;
        readDetail = err instanceof Error ? err.message : String(err);
      }
      check(
        'credential cannot read octo.workspaces',
        readDenied,
        readDenied ? '' : 'read unexpectedly succeeded'
      );
      if (readDenied) {
        check(
          'control-plane refusal is a privilege denial',
          /permission denied|42501/i.test(readDetail),
          readDetail
        );
      }

      let writeDenied = false;
      try {
        await controlClient.query(
          `INSERT INTO octo.workspaces (id, slug, name, created_by)
           VALUES (gen_random_uuid(), 'escape', 'escape', gen_random_uuid())`
        );
      } catch {
        writeDenied = true;
      }
      check('credential cannot write octo.workspaces', writeDenied, writeDenied ? '' : 'write unexpectedly succeeded');
    } catch (err) {
      check('credential connected to the control database', false, err instanceof Error ? err.message : String(err));
    } finally {
      await controlClient.end().catch(() => undefined);
    }

    const toOther = await canConnect(withDatabase(a.connectionString, b.dbName));
    check(
      'credential cannot connect to another workspace\'s database',
      !toOther.ok,
      toOther.ok ? 'connection unexpectedly succeeded' : ''
    );

    // Deleting a workspace drops the database and role the cascade cannot reach.
    // Proven here because it is the one teardown path no cascade covers.
    console.log('teardown drops the database and its role');
    await dropProvisionedDatabase(a.dbName, a.roleName);
    const gone = await owner.query<{ db: boolean; role: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS db,
              EXISTS(SELECT 1 FROM pg_roles WHERE rolname = $2) AS role`,
      [a.dbName, a.roleName]
    );
    check('the dropped database is gone', gone.rows[0]?.db === false);
    check('the dropped role is gone', gone.rows[0]?.role === false);
    created.splice(
      created.findIndex((c) => c.dbName === a.dbName),
      1
    );
  } finally {
    console.log('cleanup');
    for (const { dbName, roleName } of created) {
      await dropProvisionedDatabase(dbName, roleName).catch(() => undefined);
    }
    await owner.end().catch(() => undefined);
  }

  if (failures.length > 0) {
    console.error(`\nverify-provisioned-database: ${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log('\nverify-provisioned-database: all checks passed');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
