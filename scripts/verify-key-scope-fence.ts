/**
 * Live key-scope fence verification (Slice 14).
 *
 * The application's own `keyWorkspaceMatches` check refuses a workspace-scoped key
 * on the wrong workspace long before any query runs. That means an HTTP test can
 * pass even if Row-Level Security is dormant. This script removes the application
 * from the picture entirely: it seeds two-plus workspaces owned by ONE principal
 * (so membership checks would happily allow cross-workspace access), then connects
 * as the fenced runtime role `octo_app`, binds a workspace scope the way the server
 * does, and asserts the ENGINE refuses to read or write another workspace.
 *
 * It proves the slice's core invariant directly:
 *   For any scope W, and any workspace X != W, a session scoped to W can neither
 *   see nor write any row of X -- even though its principal is a member of X.
 *
 * It also covers a non-`files` table (`documents`/`chunks`, the RAG path) so the
 * fence is proven on more than the endpoint a public test would name, and asserts
 * the identity GUC cannot leak past its transaction on a pooled connection.
 *
 * Env:
 *   DATABASE_URL     schema-owner connection (seed + role assertions + cleanup)
 *   OCTO_DB_URL      octo_app connection (the fenced role under test)
 *
 * Exit code 0 = all checks passed; 1 = a check failed; 2 = misconfigured.
 */

import pg from 'pg';

const ownerUrl = process.env['DATABASE_URL'] ?? process.env['OCTO_OWNER_URL'];
const appUrl = process.env['OCTO_DB_URL'];

if (!ownerUrl || !appUrl) {
  console.error(
    'verify-key-scope-fence: DATABASE_URL (owner) and OCTO_DB_URL (octo_app) are both required'
  );
  process.exit(2);
}

// Fixed ids so cleanup is deterministic and re-runs are idempotent.
const P = '11111111-1111-1111-1111-111111111111';
const WORKSPACES = [
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444',
];
const CONFIGS = [
  '55555555-5555-5555-5555-555555555555',
  '66666666-6666-6666-6666-666666666666',
  '77777777-7777-7777-7777-777777777777',
];
const DOCS = [
  '88888888-8888-8888-8888-888888888888',
  '99999999-9999-9999-9999-999999999999',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
];
const VERSIONS = [
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
];
const CHUNKS = [
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
];
const FILES = [
  '22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '33333333-cccc-cccc-cccc-cccccccccccc',
  '44444444-dddd-dddd-dddd-dddddddddddd',
];

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.error(`  FAIL ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}

const owner = new pg.Client({ connectionString: ownerUrl });
const app = new pg.Client({ connectionString: appUrl });

async function cleanup(): Promise<void> {
  await owner.query(`DELETE FROM octo.files WHERE id = ANY($1)`, [FILES]);
  await owner.query(`DELETE FROM octo.chunks WHERE id = ANY($1)`, [CHUNKS]);
  await owner.query(`DELETE FROM octo.document_versions WHERE id = ANY($1)`, [VERSIONS]);
  await owner.query(`DELETE FROM octo.documents WHERE id = ANY($1)`, [DOCS]);
  await owner.query(`DELETE FROM octo.embedding_configs WHERE id = ANY($1)`, [CONFIGS]);
  await owner.query(`DELETE FROM octo.workspace_memberships WHERE principal_id = $1`, [P]);
  await owner.query(`DELETE FROM octo.workspaces WHERE id = ANY($1)`, [WORKSPACES]);
  await owner.query(`DELETE FROM octo.principals WHERE id = $1`, [P]);
}

async function seed(): Promise<void> {
  await owner.query(
    `INSERT INTO octo.principals (id, auth_user_id, email, display_name, is_guest, is_platform_owner)
     VALUES ($1, 'aaaaaaaa-0000-0000-0000-000000000001', 'fence@x', 'Fence', false, false)`,
    [P]
  );
  for (let i = 0; i < WORKSPACES.length; i++) {
    const ws = WORKSPACES[i]!;
    await owner.query(`INSERT INTO octo.workspaces (id, slug, name, created_by) VALUES ($1, $2, $3, $4)`, [
      ws,
      `fence-${i}`,
      `Fence ${i}`,
      P,
    ]);
    await owner.query(
      `INSERT INTO octo.workspace_memberships (workspace_id, principal_id, role) VALUES ($1, $2, 'owner')`,
      [ws, P]
    );
    await owner.query(
      `INSERT INTO octo.embedding_configs
         (id, workspace_id, model, model_version, dimensions, chunker, chunk_size, chunk_overlap)
       VALUES ($1, $2, 'm', 'v', 1536, 'c', 100, 10)`,
      [CONFIGS[i]!, ws]
    );
    await owner.query(`INSERT INTO octo.documents (id, workspace_id, title, created_by) VALUES ($1, $2, $3, $4)`, [
      DOCS[i]!,
      ws,
      `fence-doc-${i}`,
      P,
    ]);
    await owner.query(
      `INSERT INTO octo.document_versions
         (id, document_id, workspace_id, version_number, content_hash, mime_type, byte_size, extracted_text, extraction_status)
       VALUES ($1, $2, $3, 1, $4, 'text/plain', 1, 'body', 'extracted')`,
      [VERSIONS[i]!, DOCS[i]!, ws, `hash-${i}`]
    );
    await owner.query(
      `INSERT INTO octo.chunks
         (id, workspace_id, document_version_id, config_id, chunk_index, chunk_key, content, start_offset, end_offset, token_estimate)
       VALUES ($1, $2, $3, $4, 0, $5, $6, 0, 1, 1)`,
      [CHUNKS[i]!, ws, VERSIONS[i]!, CONFIGS[i]!, `key-${i}`, `secret-content-${i}`]
    );
    await owner.query(
      `INSERT INTO octo.files
         (id, workspace_id, created_by, name, mime_type, size_bytes, provider, storage_key, status)
       VALUES ($1, $2, $3, $4, 'text/plain', 1, 'r2', $5, 'active')`,
      [FILES[i]!, ws, P, `fence-${i}.txt`, `fence/${i}`]
    );
  }
}

/** Runs `sql` as octo_app with a workspace scope bound, transaction-locally. */
async function scoped<T extends pg.QueryResultRow>(
  workspaceId: string,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  await app.query('BEGIN');
  try {
    await app.query(`SELECT set_config('octo.principal_id', $1, true)`, [P]);
    await app.query(`SELECT set_config('request.workspace_id', $1, true)`, [workspaceId]);
    const res = await app.query<T>(sql, params);
    await app.query('COMMIT');
    return res.rows;
  } catch (err) {
    await app.query('ROLLBACK').catch(() => undefined);
    throw err;
  }
}

async function main(): Promise<void> {
  await owner.connect();
  await app.connect();

  try {
    // 1. Role assertions -- the fence only exists if the request role is neither a
    // superuser nor the table owner, and the service role bypasses RLS.
    console.log('role assertions');
    const roles = await owner.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('octo_app', 'octo_service')`
    );
    const appRole = roles.rows.find((r) => r.rolname === 'octo_app');
    const svcRole = roles.rows.find((r) => r.rolname === 'octo_service');
    check('octo_app exists and is non-superuser, non-BYPASSRLS', !!appRole && !appRole.rolsuper && !appRole.rolbypassrls);
    check('octo_service exists and bypasses RLS', !!svcRole && svcRole.rolbypassrls === true);
    const ownerCheck = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_class c
       JOIN pg_roles r ON r.oid = c.relowner
       WHERE c.relnamespace = 'octo'::regnamespace AND r.rolname = 'octo_app'`
    );
    check('octo_app owns no octo table (so ordinary RLS applies)', ownerCheck.rows[0]?.n === '0');

    // 2. Seed: one principal owning every workspace. Membership alone would allow
    // cross-workspace access; only the fence can deny it.
    console.log('seed');
    await cleanup();
    await seed();
    check('seeded 3 workspaces owned by one principal', true);

    // 3. The invariant, over every ordered pair: scoped to W_i, W_j is invisible.
    console.log('fence: cross-workspace reads are denied');
    for (let i = 0; i < WORKSPACES.length; i++) {
      const mine = WORKSPACES[i]!;
      const own = await scoped<{ n: string }>(mine, `SELECT count(*)::text AS n FROM octo.files WHERE workspace_id = $1`, [mine]);
      check(`scope W${i} sees its own file (positive control)`, own[0]?.n === '1');
      for (let j = 0; j < WORKSPACES.length; j++) {
        if (i === j) continue;
        const other = WORKSPACES[j]!;
        const files = await scoped<{ n: string }>(mine, `SELECT count(*)::text AS n FROM octo.files WHERE workspace_id = $1`, [other]);
        const docs = await scoped<{ n: string }>(mine, `SELECT count(*)::text AS n FROM octo.documents WHERE workspace_id = $1`, [other]);
        const chunks = await scoped<{ n: string }>(mine, `SELECT count(*)::text AS n FROM octo.chunks WHERE workspace_id = $1`, [other]);
        check(`scope W${i} cannot read W${j} files`, files[0]?.n === '0');
        check(`scope W${i} cannot read W${j} documents (RAG path)`, docs[0]?.n === '0');
        check(`scope W${i} cannot read W${j} chunks (RAG path)`, chunks[0]?.n === '0');
      }
    }

    // 4. The invariant for writes: a cross-workspace INSERT is refused. Membership
    // would permit it (files_insert_member is member-based), so a refusal here is
    // specifically the fence.
    console.log('fence: cross-workspace writes are denied');
    let denied = false;
    let deniedDetail = '';
    try {
      await scoped(
        WORKSPACES[0]!,
        `INSERT INTO octo.files (id, workspace_id, created_by, name, mime_type, size_bytes, provider, storage_key, status)
         VALUES (gen_random_uuid(), $1, $2, 'escape.txt', 'text/plain', 1, 'r2', 'escape', 'active')`,
        [WORKSPACES[1]!, P]
      );
    } catch (err) {
      denied = true;
      deniedDetail = err instanceof Error ? err.message : String(err);
    }
    check(
      'scope W0 cannot INSERT into W1 (fence refuses a permitted-by-membership write)',
      denied,
      denied ? '' : 'insert unexpectedly succeeded'
    );
    if (denied) {
      check('refusal is a row-level-security denial', /row-level security|tenant_scope_fence|42501/i.test(deniedDetail), deniedDetail);
    }

    // 5. GUC leak-safety: a transaction-scoped binding must not survive on the
    // pooled client for the next caller.
    console.log('identity GUC does not leak past its transaction');
    await app.query('BEGIN');
    await app.query(`SELECT set_config('request.workspace_id', $1, true)`, [WORKSPACES[0]!]);
    await app.query('COMMIT');
    const leaked = await app.query<{ v: string | null }>(`SELECT current_setting('request.workspace_id', true) AS v`);
    check('request.workspace_id is unset after COMMIT', !leaked.rows[0]?.v);

    // 6. Cleanup.
    console.log('cleanup');
    await cleanup();
  } finally {
    await app.end().catch(() => undefined);
    await owner.end().catch(() => undefined);
  }

  if (failures.length > 0) {
    console.error(`\nverify-key-scope-fence: ${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log('\nverify-key-scope-fence: all checks passed');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
