/**
 * Owner-privileged SQL for E2E fixtures.
 *
 * The server's two runtime roles are deliberately unprivileged: `octo_app` is
 * RLS-fenced and `octo_service` bypasses RLS but is still neither a superuser nor
 * the schema owner. Fixtures that need schema DDL (creating a trigger or function
 * on a tenant table, for example) must therefore connect as the schema owner via
 * DATABASE_URL, exactly as the migrations do. Reads and writes of tenant rows
 * should use the server's `queryService` instead.
 */

import pg from 'pg';

let pool: pg.Pool | undefined;

function ownerPool(): pg.Pool {
  const url = process.env['DATABASE_URL'] ?? process.env['OCTO_OWNER_URL'];
  if (!url) {
    throw new Error('owner-db: DATABASE_URL (schema owner) is required for owner fixture SQL');
  }
  pool ??= new pg.Pool({ connectionString: url, max: 2 });
  return pool;
}

export async function ownerQuery<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await ownerPool().query(text, params);
  return res.rows as T[];
}
