/**
 * Octo Database Client (Server Runtime)
 *
 * Connects directly to PostgreSQL canonical tables in the octo schema.
 * Executes all queries against real PostgreSQL tables and SECURITY DEFINER RPCs.
 */

import pg from 'pg';
const { Pool } = pg;

export interface DbConfig {
  connectionString: string;
}

const connectionString =
  process.env['DATABASE_URL'] ??
  process.env['POSTGRES_URL'] ??
  process.env['SUPABASE_DB_URL'] ??
  'postgresql://postgres:postgres@localhost:54329/postgres';

export const dbPool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
});

export async function query<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = await dbPool.connect();
  try {
    const res = await client.query(text, params);
    return res.rows as T[];
  } finally {
    client.release();
  }
}

export async function testDbConnection(): Promise<{ connected: boolean; version?: string; error?: string }> {
  try {
    const rows = await query<{ version: string }>('SELECT version()');
    return { connected: true, version: rows[0]?.version };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { connected: false, error: message };
  }
}

// 1. Principals & Workspaces Operations
export async function dbInsertGuestPrincipal(
  id: string,
  authUserId: string,
  email: string,
  displayName: string
): Promise<{ id: string; email: string; displayName: string; isGuest: boolean }> {
  const sql = `
    INSERT INTO octo.principals (id, auth_user_id, email, display_name, is_guest, is_platform_owner)
    VALUES ($1, $2, $3, $4, true, false)
    ON CONFLICT (auth_user_id) DO UPDATE SET updated_at = now()
    RETURNING id, email, display_name AS "displayName", is_guest AS "isGuest";
  `;
  const rows = await query<{ id: string; email: string; displayName: string; isGuest: boolean }>(sql, [
    id,
    authUserId,
    email,
    displayName,
  ]);
  return rows[0]!;
}

export async function dbInsertWorkspace(
  id: string,
  slug: string,
  name: string,
  description: string,
  createdBy: string
): Promise<{ id: string; slug: string; name: string; description: string }> {
  const sql = `
    INSERT INTO octo.workspaces (id, slug, name, description, created_by)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (slug) DO UPDATE SET updated_at = now()
    RETURNING id, slug, name, description;
  `;
  const rows = await query<{ id: string; slug: string; name: string; description: string }>(sql, [
    id,
    slug,
    name,
    description,
    createdBy,
  ]);
  return rows[0]!;
}

export async function dbInsertMembership(
  workspaceId: string,
  principalId: string,
  role: string
): Promise<void> {
  const sql = `
    INSERT INTO octo.workspace_memberships (workspace_id, principal_id, role)
    VALUES ($1, $2, $3)
    ON CONFLICT (workspace_id, principal_id) DO UPDATE SET role = EXCLUDED.role, updated_at = now();
  `;
  await query(sql, [workspaceId, principalId, role]);
}

export async function dbGetAuthorizedWorkspaces(principalId: string): Promise<
  { id: string; slug: string; name: string; description: string | null; role: string; isOwner: boolean }[]
> {
  const sql = `
    SELECT 
      w.id,
      w.slug,
      w.name,
      w.description,
      m.role,
      (m.role = 'owner') AS "isOwner"
    FROM octo.workspaces w
    JOIN octo.workspace_memberships m ON m.workspace_id = w.id
    WHERE m.principal_id = $1
    ORDER BY w.name ASC;
  `;
  return query(sql, [principalId]);
}

export async function dbGetWorkspaceMembership(
  workspaceId: string,
  principalId: string
): Promise<{ role: string } | null> {
  const sql = `
    SELECT role
    FROM octo.workspace_memberships
    WHERE workspace_id = $1 AND principal_id = $2
    LIMIT 1;
  `;
  const rows = await query<{ role: string }>(sql, [workspaceId, principalId]);
  return rows[0] ?? null;
}

// 2. File Catalog Operations
export async function dbInsertFile(
  id: string,
  workspaceId: string,
  createdBy: string,
  name: string,
  mimeType: string,
  sizeBytes: number,
  storageKey: string,
  contentHash: string | null = null
): Promise<{ id: string; name: string; sizeBytes: number; mimeType: string; storageKey: string }> {
  const sql = `
    INSERT INTO octo.files (id, workspace_id, created_by, name, mime_type, size_bytes, provider, storage_key, status, content_hash)
    VALUES ($1, $2, $3, $4, $5, $6, 'r2', $7, 'active', $8)
    RETURNING id, name, size_bytes AS "sizeBytes", mime_type AS "mimeType", storage_key AS "storageKey";
  `;
  const rows = await query<{ id: string; name: string; sizeBytes: number; mimeType: string; storageKey: string }>(
    sql,
    [id, workspaceId, createdBy, name, mimeType, sizeBytes, storageKey, contentHash]
  );
  return rows[0]!;
}

export async function dbListWorkspaceFiles(workspaceId: string): Promise<
  { id: string; name: string; sizeBytes: number; mimeType: string; storageKey: string; createdAt: string }[]
> {
  const sql = `
    SELECT id, name, size_bytes AS "sizeBytes", mime_type AS "mimeType", storage_key AS "storageKey", created_at AS "createdAt"
    FROM octo.files
    WHERE workspace_id = $1 AND status = 'active'
    ORDER BY created_at DESC;
  `;
  return query(sql, [workspaceId]);
}

export async function dbGetFile(
  workspaceId: string,
  fileId: string
): Promise<{ id: string; name: string; storageKey: string; sizeBytes: number; mimeType: string } | null> {
  const sql = `
    SELECT id, name, storage_key AS "storageKey", size_bytes AS "sizeBytes", mime_type AS "mimeType"
    FROM octo.files
    WHERE id = $1 AND workspace_id = $2 AND status = 'active'
    LIMIT 1;
  `;
  const rows = await query<{ id: string; name: string; storageKey: string; sizeBytes: number; mimeType: string }>(
    sql,
    [fileId, workspaceId]
  );
  return rows[0] ?? null;
}

export async function dbDeleteFile(workspaceId: string, fileId: string): Promise<{ storageKey: string } | null> {
  const sql = `
    DELETE FROM octo.files
    WHERE id = $1 AND workspace_id = $2
    RETURNING storage_key AS "storageKey";
  `;
  const rows = await query<{ storageKey: string }>(sql, [fileId, workspaceId]);
  return rows[0] ?? null;
}

// 3. API Key Operations
export async function dbInsertApiKey(
  id: string,
  keyHash: string,
  prefix: string,
  name: string,
  principalId: string,
  workspaceId: string | null,
  role: string | null,
  scopes: string[]
): Promise<void> {
  const sql = `
    INSERT INTO octo.api_keys (id, key_hash, prefix, name, principal_id, workspace_id, role, scopes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
  `;
  await query(sql, [id, keyHash, prefix, name, principalId, workspaceId, role, scopes]);
}

export async function dbVerifyApiKey(keyHash: string): Promise<{
  keyId: string;
  prefix: string;
  keyName: string;
  principalId: string;
  workspaceId: string | null;
  role: string | null;
  scopes: string[];
} | null> {
  // Uses SECURITY DEFINER function from migration!
  const sql = `
    SELECT 
      key_id AS "keyId",
      prefix,
      key_name AS "keyName",
      principal_id AS "principalId",
      workspace_id AS "workspaceId",
      role,
      scopes
    FROM octo.verify_api_key($1);
  `;
  const rows = await query<{
    keyId: string;
    prefix: string;
    keyName: string;
    principalId: string;
    workspaceId: string | null;
    role: string | null;
    scopes: string[];
  }>(sql, [keyHash]);
  return rows[0] ?? null;
}

export async function dbListApiKeys(principalId: string): Promise<
  { id: string; prefix: string; name: string; workspaceId: string | null; scopes: string[]; createdAt: string }[]
> {
  const sql = `
    SELECT id, prefix, name, workspace_id AS "workspaceId", scopes, created_at AS "createdAt"
    FROM octo.api_keys
    WHERE principal_id = $1
    ORDER BY created_at DESC;
  `;
  return query(sql, [principalId]);
}
