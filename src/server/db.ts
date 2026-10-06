/**
 * Octo Database Client (Server Runtime)
 *
 * Connects directly to PostgreSQL canonical tables in the octo schema.
 * Executes all queries against real PostgreSQL tables and SECURITY DEFINER RPCs.
 */

import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
const { Pool } = pg;

/**
 * Two database roles, two pools (Slice 14 — key-scope isolation fence):
 *
 * - `appPool`  connects as `octo_app` (a non-superuser, non-owner role). Because it
 *   is neither, Row-Level Security applies to it: the fence policies narrow every
 *   request to the workspace its credential is scoped to. This is the pool the
 *   authenticated data path runs on.
 * - `servicePool` connects as `octo_service` (BYPASSRLS). It is the small trusted
 *   surface that runs with no caller identity: login / bootstrap, the job worker,
 *   the archive lifecycle, and the server-owned control writes (jobs/activity)
 *   that intentionally have no client-side policy. Importing it is the grep-able
 *   boundary for "this code holds bypass authority."
 *
 * If neither OCTO_DB_URL nor OCTO_SERVICE_URL is set, both fall back to
 * DATABASE_URL, preserving the single-superuser connection used by local dev and
 * CI until the scoped roles are provisioned.
 */
export interface DbConfig {
  connectionString: string;
}

const legacyUrl =
  process.env['DATABASE_URL'] ??
  process.env['POSTGRES_URL'] ??
  process.env['SUPABASE_DB_URL'] ??
  'postgresql://postgres:postgres@localhost:54329/postgres';

// `||` (not `??`) so an empty value in a copied .env falls back rather than
// producing an empty connection string.
const appUrl = process.env['OCTO_DB_URL'] || legacyUrl;
const serviceUrl = process.env['OCTO_SERVICE_URL'] || legacyUrl;

export const dbPool = new Pool({
  connectionString: appUrl,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export const servicePool = new Pool({
  connectionString: serviceUrl,
  max: 6,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// An idle pooled client can error (server restart, network reset, admin
// termination). Without a listener Node rethrows that 'error' event as an
// uncaught exception and the single-process host exits, so log and continue:
// the pool discards the broken client and the next query dials a fresh one.
dbPool.on('error', (err) => {
  console.error('[db] idle client error:', err.message);
});
servicePool.on('error', (err) => {
  console.error('[db] idle service client error:', err.message);
});

/**
 * The caller identity for the current request, populated by `authenticateRequest`
 * and read by `query()` to set the RLS claims. `runWithRequestIdentity()` seeds it
 * at the top of every request so each concurrent request carries its own object.
 *
 * `principalId` is bound directly (not derived from an auth-user lookup) so the
 * fence helpers resolve the exact caller even for a request whose first fenced read
 * would otherwise have to query `principals` — the chicken/egg the auth-bootstrap
 * readers used to hit before their identity existed.
 */
export interface RequestIdentity {
  principalId: string;
  workspaceId: string | null;
}
export const requestIdentity = new AsyncLocalStorage<RequestIdentity>();

/**
 * Binds the caller's principal id and, for a workspace-scoped key, its workspace
 * scope inside the current transaction via `set_config(..., is_local => true)`.
 * `is_local` guarantees both GUCs are discarded at COMMIT/ROLLBACK, so identity can
 * never survive on a client returned to the pool and be seen by the next caller —
 * the exact cross-tenant leak this guards. `octo.principal_id` is what the fence
 * helpers read; `request.workspace_id` is the key's scope (empty = unscoped).
 */
async function bindIdentity(client: pg.Client, id: RequestIdentity | undefined): Promise<void> {
  // Bind only once authentication has resolved a principal. An app-pool query that
  // runs before that leaves the claims unset, so RLS evaluates current_principal_id()
  // as NULL and fails closed — pre-identity reads must use queryService, never the
  // app pool.
  if (!id || !id.principalId) return;
  await client.query('SELECT set_config(\'octo.principal_id\', $1, true)', [id.principalId]);
  await client.query('SELECT set_config(\'request.workspace_id\', $1, true)', [id.workspaceId ?? '']);
}

/**
 * Fills in the current request's identity holder after authentication resolves.
 * The dispatcher seeds an empty holder at the top of every request; the store
 * object is mutated here so that every later `query()` on the app pool binds these
 * claims inside its own transaction. `workspaceId` is the *key's* scope (NULL for
 * an account-wide key or human session), which is what the fence restricts to.
 */
export function bindRequestIdentity(principalId: string, workspaceId: string | null): void {
  const id = requestIdentity.getStore();
  if (id) {
    id.principalId = principalId;
    id.workspaceId = workspaceId;
  }
}

/**
 * Runs `fn` with a fresh, empty identity holder bound to the async context, so
 * concurrent requests never share claims. Callers fill it via `bindRequestIdentity`
 * once authenticated. Without a wrapper, `query()` sees no store and binds nothing.
 */
export function runWithRequestIdentity<T>(fn: () => Promise<T>): Promise<T> {
  return requestIdentity.run({ principalId: '', workspaceId: null }, fn);
}

/**
 * Runs a single statement on the app pool, fenced. When a request identity is in
 * scope it is bound inside a transaction (BEGIN + COMMIT/ROLLBACK) so RLS sees it
 * and it cannot leak past this call. Pre-identity code that must run fenced passes
 * through here only after `authenticateRequest` has populated the store.
 */
export async function query<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
  const id = requestIdentity.getStore();
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    if (id) await bindIdentity(client, id);
    const res = await client.query(text, params);
    await client.query('COMMIT');
    return res.rows as T[];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Runs a single statement on the service pool (BYPASSRLS, no identity binding).
 * Reserved for login / bootstrap, the job worker, the archive lifecycle, and the
 * server-owned jobs/activity control writes — the surface that runs with no caller
 * principal and must therefore not be fenced.
 */
export async function queryService<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = await servicePool.connect();
  try {
    const res = await client.query(text, params);
    return res.rows as T[];
  } finally {
    client.release();
  }
}

/**
 * Runs `fn` inside a single transaction on one pooled client. Commits on success,
 * rolls back on any throw, and always releases the client. Multi-write invariants
 * (workspace + owner membership + key) must use this rather than separate `query`
 * calls, which each check out their own connection and cannot roll back together.
 *
 * `pool` defaults to the app pool (identity bound at BEGIN). Control-plane and
 * bootstrap transactions pass `servicePool` and are not fenced.
 */
export async function withTransaction<T>(
  fn: (client: { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }) => Promise<T>,
  pool: pg.Pool = dbPool
): Promise<T> {
  const id = pool === dbPool ? requestIdentity.getStore() : undefined;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (id) await bindIdentity(client, id);
    const result = await fn({
      query: async (text: string, params: unknown[] = []) => {
        const res = await client.query(text, params);
        return { rows: res.rows as unknown[] };
      },
    });
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
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
  const rows = await queryService<{ id: string; email: string; displayName: string; isGuest: boolean }>(sql, [
    id,
    authUserId,
    email,
    displayName,
  ]);
  return rows[0]!;
}

export async function dbUpsertGooglePrincipal(
  authUserId: string,
  email: string,
  displayName: string | null,
  avatarUrl: string | null
): Promise<{
  id: string;
  authUserId: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  isGuest: boolean;
  isPlatformOwner: boolean;
}> {
  const ownerEmail = process.env['PLATFORM_OWNER_EMAIL'];
  const isOwner = Boolean(ownerEmail) && email.toLowerCase() === ownerEmail!.toLowerCase();
  const sql = `
    INSERT INTO octo.principals (id, auth_user_id, email, display_name, avatar_url, is_guest, is_platform_owner)
    VALUES (gen_random_uuid(), $1, $2, $3, $4, false, $5)
    ON CONFLICT (auth_user_id) DO UPDATE SET
      email = EXCLUDED.email,
      display_name = COALESCE(EXCLUDED.display_name, octo.principals.display_name),
      avatar_url = COALESCE(EXCLUDED.avatar_url, octo.principals.avatar_url),
      is_platform_owner = octo.principals.is_platform_owner OR EXCLUDED.is_platform_owner,
      is_guest = false,
      updated_at = now()
    RETURNING id, auth_user_id AS "authUserId", email, display_name AS "displayName", avatar_url AS "avatarUrl", is_guest AS "isGuest", is_platform_owner AS "isPlatformOwner";
  `;
  const rows = await queryService<{
    id: string;
    authUserId: string;
    email: string;
    displayName: string | null;
    avatarUrl: string | null;
    isGuest: boolean;
    isPlatformOwner: boolean;
  }>(sql, [authUserId, email, displayName, avatarUrl, isOwner]);
  return rows[0]!;
}

export async function dbInsertWorkspace(
  id: string,
  slug: string,
  name: string,
  description: string,
  createdBy: string
): Promise<{ id: string; slug: string; name: string; description: string }> {
  // This path only ever provisions the sandbox a principal is handed at sign-in,
  // so it is marked auto_provisioned: it must not count against the Slice 16
  // daily creation limit, which bounds deliberate POST /api/workspaces creates.
  const sql = `
    INSERT INTO octo.workspaces (id, slug, name, description, created_by, auto_provisioned)
    VALUES ($1, $2, $3, $4, $5, true)
    ON CONFLICT (slug) DO UPDATE SET updated_at = now()
    RETURNING id, slug, name, description;
  `;
  const rows = await queryService<{ id: string; slug: string; name: string; description: string }>(sql, [
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
  await queryService(sql, [workspaceId, principalId, role]);
}

export async function dbGetAuthorizedWorkspaces(principalId: string): Promise<
  {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    role: string;
    isOwner: boolean;
    retentionDays: number | null;
  }[]
> {
  // Authorization bootstrap: this runs the owner's cross-workspace bypass and a
  // principal's own membership join. Both read `principals`/`workspace_memberships`
  // by an explicit principal id that is not necessarily the bound RLS identity (the
  // OAuth callback and signed-media paths call it before any identity is bound), so
  // it runs on the trusted service pool. Route-level `requireScope`/`keyWorkspaceMatches`
  // remain the authority; the fence still guards every user-data read downstream.
  const pRows = await queryService<{ is_platform_owner: boolean }>(
    'SELECT is_platform_owner FROM octo.principals WHERE id = $1',
    [principalId]
  );
  if (pRows[0]?.is_platform_owner) {
    const sql = `
      SELECT
        w.id,
        w.slug,
        w.name,
        w.description,
        'owner' AS role,
        true AS "isOwner",
        w.retention_days AS "retentionDays"
      FROM octo.workspaces w
      ORDER BY w.name ASC;
    `;
    return queryService(sql, []);
  }
  const sql = `
    SELECT
      w.id,
      w.slug,
      w.name,
      w.description,
      m.role,
      (m.role = 'owner') AS "isOwner",
      w.retention_days AS "retentionDays"
    FROM octo.workspaces w
    JOIN octo.workspace_memberships m ON m.workspace_id = w.id
    WHERE m.principal_id = $1
    ORDER BY w.name ASC;
  `;
  return queryService(sql, [principalId]);
}

export async function dbGetWorkspaceMembership(
  workspaceId: string,
  principalId: string
): Promise<{ role: string } | null> {
  // Same bootstrap reason as dbGetAuthorizedWorkspaces: the worker and signed-media
  // paths resolve membership for a principal id with no bound RLS identity, so this
  // must not depend on the fence. It is a read only; it grants no bypass.
  const pRows = await queryService<{ is_platform_owner: boolean }>(
    'SELECT is_platform_owner FROM octo.principals WHERE id = $1',
    [principalId]
  );
  if (pRows[0]?.is_platform_owner) {
    return { role: 'owner' };
  }
  const sql = `
    SELECT role
    FROM octo.workspace_memberships
    WHERE workspace_id = $1 AND principal_id = $2
    LIMIT 1;
  `;
  const rows = await queryService<{ role: string }>(sql, [workspaceId, principalId]);
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
  {
    id: string;
    name: string;
    sizeBytes: number;
    mimeType: string;
    storageKey: string;
    createdAt: string;
    archiveState: string;
  }[]
> {
  const sql = `
    SELECT id, name, size_bytes AS "sizeBytes", mime_type AS "mimeType",
           storage_key AS "storageKey", created_at AS "createdAt",
           archive_state AS "archiveState"
    FROM octo.files
    WHERE workspace_id = $1 AND status = 'active'
    ORDER BY created_at DESC;
  `;
  return query(sql, [workspaceId]);
}

export async function dbGetFile(
  workspaceId: string,
  fileId: string
): Promise<{
  id: string;
  name: string;
  storageKey: string;
  sizeBytes: number;
  mimeType: string;
  archiveState: string;
  archiveLocator: string | null;
  archiveHash: string | null;
} | null> {
  const sql = `
    SELECT id, name, storage_key AS "storageKey", size_bytes AS "sizeBytes",
           mime_type AS "mimeType", archive_state AS "archiveState",
           archive_locator AS "archiveLocator", archive_hash AS "archiveHash"
    FROM octo.files
    WHERE id = $1 AND workspace_id = $2 AND status = 'active'
    LIMIT 1;
  `;
  const rows = await query<{
    id: string;
    name: string;
    storageKey: string;
    sizeBytes: number;
    mimeType: string;
    archiveState: string;
    archiveLocator: string | null;
    archiveHash: string | null;
  }>(sql, [fileId, workspaceId]);
  return rows[0] ?? null;
}

/**
 * Loads the record the archive/restore lifecycle needs. Distinct from dbGetFile
 * because it also serves files whose active bytes were pruned after archiving.
 */
export async function dbGetArchiveRecord(
  workspaceId: string,
  fileId: string
): Promise<{
  fileId: string;
  workspaceId: string;
  name: string;
  mimeType: string;
  storageKey: string;
  archiveState: string;
  archiveLocator: string | null;
  archiveHash: string | null;
} | null> {
  const sql = `
    SELECT id AS "fileId", workspace_id AS "workspaceId", name,
           mime_type AS "mimeType", storage_key AS "storageKey",
           archive_state AS "archiveState", archive_locator AS "archiveLocator",
           archive_hash AS "archiveHash"
    FROM octo.files
    WHERE id = $1 AND workspace_id = $2 AND status = 'active'
    LIMIT 1;
  `;
  const rows = await queryService<{
    fileId: string;
    workspaceId: string;
    name: string;
    mimeType: string;
    storageKey: string;
    archiveState: string;
    archiveLocator: string | null;
    archiveHash: string | null;
  }>(sql, [fileId, workspaceId]);
  return rows[0] ?? null;
}

/** Persists a lifecycle transition. Only the supplied columns are written. */
export async function dbUpdateArchiveState(
  fileId: string,
  patch: {
    archiveState?: string;
    archiveProvider?: string | null;
    archiveLocator?: string | null;
    archiveHash?: string | null;
    archivedAt?: string | null;
    lastVerifiedAt?: string | null;
  }
): Promise<void> {
  const columns: Record<string, string> = {
    archiveState: 'archive_state',
    archiveProvider: 'archive_provider',
    archiveLocator: 'archive_locator',
    archiveHash: 'archive_hash',
    archivedAt: 'archived_at',
    lastVerifiedAt: 'last_verified_at',
  };

  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, column] of Object.entries(columns)) {
    if (key in patch) {
      params.push((patch as Record<string, unknown>)[key]);
      sets.push(`${column} = $${params.length}`);
    }
  }

  if (sets.length === 0) return;
  params.push(fileId);
  const updated = await queryService<{ id: string }>(
    `UPDATE octo.files SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length} RETURNING id`,
    params
  );
  if (updated.length === 0) {
    throw new Error(`File ${fileId} no longer exists`);
  }
}

/** Deletes a file only when no archive/restore transition is queued or running. */
export async function dbDeleteFileIfIdle(
  workspaceId: string,
  fileId: string
): Promise<
  | { status: 'deleted'; storageKey: string }
  | { status: 'missing' }
  | { status: 'busy' }
> {
  return withTransaction(async (client) => {
    const files = await client.query(
      `SELECT id, storage_key AS "storageKey", archive_state AS "archiveState"
       FROM octo.files WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
      [fileId, workspaceId]
    );
    const file = files.rows[0] as { id: string; storageKey: string; archiveState: string } | undefined;
    if (!file) return { status: 'missing' };

    // No FOR UPDATE here: octo.jobs carries only a SELECT policy, so a locking read
    // returns zero rows for the non-owner app role and the busy check silently passes.
    // Serialization against enqueue does not need it — the file row lock above is the
    // gate, and dbEnqueueFileTransition (service pool) also locks the file row.
    const transitions = await client.query(
      `SELECT id FROM octo.jobs
       WHERE workspace_id = $1 AND job_type IN ('archive_file', 'restore_file')
         AND payload->>'fileId' = $2 AND state IN ('queued', 'running')`,
      [workspaceId, fileId]
    );
    if (
      transitions.rows.length > 0 ||
      file.archiveState === 'archiving' ||
      file.archiveState === 'restoring'
    ) {
      return { status: 'busy' };
    }

    const deleted = await client.query(
      `DELETE FROM octo.files WHERE id = $1 AND workspace_id = $2
       RETURNING storage_key AS "storageKey"`,
      [fileId, workspaceId]
    );
    const row = deleted.rows[0] as { storageKey: string } | undefined;
    return row ? { status: 'deleted', storageKey: row.storageKey } : { status: 'missing' };
  });
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
  scopes: string[],
  expiresAt: string | null = null
): Promise<void> {
  const sql = `
    INSERT INTO octo.api_keys (id, key_hash, prefix, name, principal_id, workspace_id, role, scopes, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
  `;
  await query(sql, [id, keyHash, prefix, name, principalId, workspaceId, role, scopes, expiresAt]);
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
  const rows = await queryService<{
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
  {
    id: string;
    prefix: string;
    name: string;
    workspaceId: string | null;
    scopes: string[];
    expiresAt: string | null;
    lastUsedAt: string | null;
    createdAt: string;
  }[]
> {
  const sql = `
    SELECT id, prefix, name, workspace_id AS "workspaceId", scopes,
           expires_at AS "expiresAt", last_used_at AS "lastUsedAt", created_at AS "createdAt"
    FROM octo.api_keys
    WHERE principal_id = $1
    ORDER BY created_at DESC;
  `;
  return query(sql, [principalId]);
}

// 4. Scoped Share Operations (Slice 4)
export interface DbShareRow {
  id: string;
  workspaceId: string;
  resourceType: string;
  resourceId: string | null;
  tokenPrefix: string;
  permission: string;
  validFrom: string;
  validUntil: string | null;
  revokedAt: string | null;
  createdAt: string;
  lastAccessedAt: string | null;
  accessCount: number;
}

export async function dbInsertShare(
  id: string,
  workspaceId: string,
  resourceType: string,
  resourceId: string | null,
  tokenHash: string,
  tokenPrefix: string,
  permission: string,
  validUntil: string | null,
  createdBy: string
): Promise<DbShareRow> {
  const sql = `
    INSERT INTO octo.shares
      (id, workspace_id, resource_type, resource_id, token_hash, token_prefix, permission, valid_until, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING
      id, workspace_id AS "workspaceId", resource_type AS "resourceType", resource_id AS "resourceId",
      token_prefix AS "tokenPrefix", permission, valid_from AS "validFrom", valid_until AS "validUntil",
      revoked_at AS "revokedAt", created_at AS "createdAt",
      last_accessed_at AS "lastAccessedAt", access_count AS "accessCount";
  `;
  const rows = await query<DbShareRow>(sql, [
    id,
    workspaceId,
    resourceType,
    resourceId,
    tokenHash,
    tokenPrefix,
    permission,
    validUntil,
    createdBy,
  ]);
  return rows[0]!;
}

/**
 * Resolves an active share by token hash through the SECURITY DEFINER function.
 * Anonymous callers have no session, so this must not rely on RLS.
 */
export async function dbResolveShareByTokenHash(tokenHash: string): Promise<{
  shareId: string;
  workspaceId: string;
  resourceType: string;
  resourceId: string | null;
  permission: string;
  validUntil: string | null;
  createdBy: string;
} | null> {
  const sql = `
    SELECT s.id AS "shareId", s.workspace_id AS "workspaceId", s.resource_type AS "resourceType",
           s.resource_id AS "resourceId", s.permission, s.valid_until AS "validUntil",
           s.created_by AS "createdBy"
    FROM octo.resolve_share($1) r
    JOIN octo.shares s ON s.id = r.share_id;
  `;
  const rows = await queryService<{
    shareId: string;
    workspaceId: string;
    resourceType: string;
    resourceId: string | null;
    permission: string;
    validUntil: string | null;
    createdBy: string;
  }>(sql, [tokenHash]);
  return rows[0] ?? null;
}

/**
 * Re-checks that a share referenced by a signed media URL is still active. Like the
 * token resolver, this runs before any principal identity exists (a media token
 * carries a share id, not a caller), so it reads through the service pool.
 */
export async function dbResolveShareById(shareId: string): Promise<{
  workspaceId: string;
  createdBy: string;
  validUntil: string | null;
} | null> {
  const sql = `
    SELECT workspace_id AS "workspaceId", created_by AS "createdBy", valid_until AS "validUntil"
    FROM octo.shares
    WHERE id = $1
      AND revoked_at IS NULL
      AND valid_from <= now()
      AND (valid_until IS NULL OR valid_until > now())
    LIMIT 1;
  `;
  const rows = await queryService<{ workspaceId: string; createdBy: string; validUntil: string | null }>(sql, [shareId]);
  return rows[0] ?? null;
}

export async function dbListShares(workspaceId: string): Promise<DbShareRow[]> {
  const sql = `
    SELECT
      id, workspace_id AS "workspaceId", resource_type AS "resourceType", resource_id AS "resourceId",
      token_prefix AS "tokenPrefix", permission, valid_from AS "validFrom", valid_until AS "validUntil",
      revoked_at AS "revokedAt", created_at AS "createdAt",
      last_accessed_at AS "lastAccessedAt", access_count AS "accessCount"
    FROM octo.shares
    WHERE workspace_id = $1
    ORDER BY created_at DESC;
  `;
  return query<DbShareRow>(sql, [workspaceId]);
}

/** Revokes a share. Returns the workspace id, or null when no such share exists. */
export async function dbRevokeShare(shareId: string): Promise<{ workspaceId: string } | null> {
  const sql = `
    UPDATE octo.shares
    SET revoked_at = now()
    WHERE id = $1 AND revoked_at IS NULL
    RETURNING workspace_id AS "workspaceId";
  `;
  const rows = await query<{ workspaceId: string }>(sql, [shareId]);
  return rows[0] ?? null;
}

// 5. Job Operations (Slice 6)
export interface DbJobRow {
  id: string;
  workspaceId: string;
  jobType: string;
  state: string;
  idempotencyKey: string;
  attempt: number;
  maxAttempts: number;
  availableAt: string;
  leaseExpiresAt: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  errorCode: string | null;
  errorSummary: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const JOB_COLUMNS = `
  id, workspace_id AS "workspaceId", job_type AS "jobType", state,
  idempotency_key AS "idempotencyKey", attempt, max_attempts AS "maxAttempts",
  available_at AS "availableAt", lease_expires_at AS "leaseExpiresAt",
  payload, result, error_code AS "errorCode", error_summary AS "errorSummary",
  completed_at AS "completedAt", created_at AS "createdAt", updated_at AS "updatedAt"
`;

/**
 * Enqueues a job. A repeat with the same workspace, type, and idempotency key
 * returns the existing job rather than creating a second logical unit.
 */
export async function dbEnqueueJob(
  id: string,
  workspaceId: string,
  jobType: string,
  idempotencyKey: string,
  payload: Record<string, unknown>,
  createdBy: string | null,
  maxAttempts = 3
): Promise<{ job: DbJobRow; created: boolean }> {
  const insertSql = `
    INSERT INTO octo.jobs
      (id, workspace_id, job_type, idempotency_key, payload, created_by, max_attempts)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (workspace_id, job_type, idempotency_key) DO NOTHING
    RETURNING ${JOB_COLUMNS};
  `;
  const inserted = await queryService<DbJobRow>(insertSql, [
    id,
    workspaceId,
    jobType,
    idempotencyKey,
    JSON.stringify(payload),
    createdBy,
    maxAttempts,
  ]);

  if (inserted[0]) {
    return { job: inserted[0], created: true };
  }

  const existing = await queryService<DbJobRow>(
    `SELECT ${JOB_COLUMNS} FROM octo.jobs
     WHERE workspace_id = $1 AND job_type = $2 AND idempotency_key = $3`,
    [workspaceId, jobType, idempotencyKey]
  );
  return { job: existing[0]!, created: false };
}

/** Queues one archive/restore transition while serialized with file deletion. */
export async function dbEnqueueFileTransition(
  id: string,
  workspaceId: string,
  direction: 'archive' | 'restore',
  idempotencyPrefix: string,
  payload: Record<string, unknown>,
  createdBy: string | null
): Promise<
  | { status: 'missing' }
  | { status: 'busy' }
  | { status: 'queued'; job: DbJobRow; created: boolean }
> {
  const fileId = String(payload['fileId'] ?? '');
  const jobType = direction === 'archive' ? 'archive_file' : 'restore_file';

  // Server-owned job transition, trusted/internal callers only. It INSERTs into
  // octo.jobs (which intentionally has no client-side write policy) and reads
  // octo.files without the RLS fence, so it runs on the service pool like every
  // other jobs/activity write. Every caller must have already performed a fenced,
  // scope-bound read of the same file on the app pool — the archive/restore route
  // does this via dbGetFile immediately before enqueueing — so a workspace-scoped
  // key naming another workspace is refused before reaching here. Do not expose
  // this as a client-facing operation. The `FOR UPDATE` row lock is load-bearing:
  // it serializes this transition against dbDeleteFileIfIdle.
  return withTransaction(async (client) => {
    const files = await client.query(
      `SELECT id, archive_state AS "archiveState" FROM octo.files
       WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
      [fileId, workspaceId]
    );
    const file = files.rows[0] as { id: string; archiveState: string } | undefined;
    if (!file) return { status: 'missing' };

    const open = await client.query(
      `SELECT ${JOB_COLUMNS} FROM octo.jobs
       WHERE workspace_id = $1 AND job_type IN ('archive_file', 'restore_file')
         AND payload->>'fileId' = $2 AND state IN ('queued', 'running')
       ORDER BY created_at DESC FOR UPDATE`,
      [workspaceId, fileId]
    );
    const activeJob = open.rows[0] as DbJobRow | undefined;
    if (activeJob) {
      return activeJob.jobType === jobType
        ? { status: 'queued', job: activeJob, created: false }
        : { status: 'busy' };
    }
    if (file.archiveState === 'archiving' || file.archiveState === 'restoring') {
      return { status: 'busy' };
    }

    const count = await client.query(
      `SELECT count(*)::int AS count FROM octo.jobs
       WHERE workspace_id = $1 AND job_type = $2 AND payload->>'fileId' = $3`,
      [workspaceId, jobType, fileId]
    );
    const cycle = Number((count.rows[0] as { count: number } | undefined)?.count ?? 0);
    const inserted = await client.query(
      `INSERT INTO octo.jobs
         (id, workspace_id, job_type, idempotency_key, payload, created_by, max_attempts)
       VALUES ($1, $2, $3, $4, $5, $6, 3)
       ON CONFLICT (workspace_id, job_type, idempotency_key) DO NOTHING
       RETURNING ${JOB_COLUMNS}`,
      [id, workspaceId, jobType, `${idempotencyPrefix}:${cycle}`, JSON.stringify(payload), createdBy]
    );
    if (inserted.rows[0]) {
      return { status: 'queued', job: inserted.rows[0] as DbJobRow, created: true };
    }

    const existing = await client.query(
      `SELECT ${JOB_COLUMNS} FROM octo.jobs
       WHERE workspace_id = $1 AND job_type = $2 AND idempotency_key = $3`,
      [workspaceId, jobType, `${idempotencyPrefix}:${cycle}`]
    );
    return { status: 'queued', job: existing.rows[0] as DbJobRow, created: false };
  }, servicePool);
}
/** Requeues a failed transition while its file is idle (or already gone). */
export async function dbRetryJob(
  jobId: string,
  workspaceId: string
): Promise<'requeued' | 'busy' | 'not_retryable'> {
  return withTransaction(async (client) => {
    const jobs = await client.query(
      `SELECT id, job_type AS "jobType", state, payload FROM octo.jobs
       WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
      [jobId, workspaceId]
    );
    const job = jobs.rows[0] as {
      id: string;
      jobType: string;
      state: string;
      payload: Record<string, unknown>;
    } | undefined;
    if (!job || job.state !== 'failed') return 'not_retryable';

    if (job.jobType === 'archive_file' || job.jobType === 'restore_file') {
      const fileId = typeof job.payload?.['fileId'] === 'string' ? job.payload['fileId'] : '';
      const files = await client.query(
        `SELECT id, archive_state AS "archiveState" FROM octo.files
         WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
        [fileId, workspaceId]
      );
      const file = files.rows[0] as { id: string; archiveState: string } | undefined;

      // A deleted file makes the transition moot. Requeue it so the worker can
      // resolve it as a no-op rather than stranding a failure the owner cannot clear.
      if (file) {
        const open = await client.query(
          `SELECT id FROM octo.jobs
           WHERE workspace_id = $1 AND job_type IN ('archive_file', 'restore_file')
             AND payload->>'fileId' = $2 AND state IN ('queued', 'running')
           FOR UPDATE`,
          [workspaceId, fileId]
        );
        if (
          open.rows.length > 0 ||
          file.archiveState === 'archiving' ||
          file.archiveState === 'restoring'
        ) {
          return 'busy';
        }
      }
    }

    const requeued = await client.query(
      `UPDATE octo.jobs
       SET state = 'queued', attempt = 0, available_at = now(),
           error_code = NULL, error_summary = NULL, completed_at = NULL, updated_at = now()
       WHERE id = $1 AND workspace_id = $2 AND state = 'failed' RETURNING id`,
      [jobId, workspaceId]
    );
    return requeued.rows.length > 0 ? 'requeued' : 'not_retryable';
  }, servicePool);
}

export async function dbListJobs(workspaceId: string, limit = 50): Promise<DbJobRow[]> {
  return query<DbJobRow>(
    `SELECT ${JOB_COLUMNS} FROM octo.jobs
     WHERE workspace_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [workspaceId, limit]
  );
}

export async function dbClaimJob(
  worker: string,
  leaseSeconds = 60,
  targetWorkspaceId: string | null = null
): Promise<{
  jobId: string;
  workspaceId: string;
  jobType: string;
  attempt: number;
  payload: Record<string, unknown>;
} | null> {
  const rows = await queryService<{
    job_id: string;
    workspace_id: string;
    job_type: string;
    attempt: number;
    payload: Record<string, unknown>;
  }>('SELECT * FROM octo.claim_job($1, $2, $3)', [worker, leaseSeconds, targetWorkspaceId]);

  const row = rows[0];
  if (!row) return null;
  return {
    jobId: row.job_id,
    workspaceId: row.workspace_id,
    jobType: row.job_type,
    attempt: Number(row.attempt),
    payload: row.payload ?? {},
  };
}

export async function dbCompleteJob(
  jobId: string,
  result: Record<string, unknown>
): Promise<boolean> {
  const rows = await queryService<{ id: string }>(
    `UPDATE octo.jobs
     SET state = 'completed', result = $2, completed_at = now(),
         lease_expires_at = NULL, lease_owner = NULL, updated_at = now()
     WHERE id = $1 AND state = 'running'
     RETURNING id`,
    [jobId, JSON.stringify(result)]
  );
  return rows.length > 0;
}

export async function dbFailJob(
  jobId: string,
  attempt: number,
  maxAttempts: number,
  errorCode: string,
  errorSummary: string,
  retryable: boolean
): Promise<{ state: string }> {
  const exhausted = attempt >= maxAttempts;

  if (!retryable || exhausted) {
    await queryService(
      `UPDATE octo.jobs
       SET state = 'failed', error_code = $2, error_summary = $3, completed_at = now(),
           lease_expires_at = NULL, lease_owner = NULL, updated_at = now()
       WHERE id = $1`,
      [jobId, errorCode, errorSummary]
    );
    return { state: 'failed' };
  }

  const backoffSeconds = Math.min(2 ** attempt, 300);
  await queryService(
    `UPDATE octo.jobs
     SET state = 'queued', error_code = $2, error_summary = $3,
         available_at = now() + make_interval(secs => $4),
         lease_expires_at = NULL, lease_owner = NULL, updated_at = now()
     WHERE id = $1`,
    [jobId, errorCode, errorSummary, backoffSeconds]
  );
  return { state: 'queued' };
}

export async function dbRecordActivity(
  workspaceId: string,
  eventType: string,
  summary: string,
  jobId: string | null = null,
  actorPrincipalId: string | null = null,
  detail: Record<string, unknown> = {}
): Promise<void> {
  await queryService(
    `INSERT INTO octo.activity (workspace_id, job_id, actor_principal_id, event_type, summary, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [workspaceId, jobId, actorPrincipalId, eventType, summary, JSON.stringify(detail)]
  );
}

export async function dbListActivity(
  workspaceId: string,
  limit = 50
): Promise<
  {
    id: string;
    eventType: string;
    summary: string;
    jobId: string | null;
    createdAt: string;
  }[]
> {
  return query(
    `SELECT id, event_type AS "eventType", summary, job_id AS "jobId", created_at AS "createdAt"
     FROM octo.activity
     WHERE workspace_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [workspaceId, limit]
  );
}

export interface OpsEventInput {
  workspaceId: string | null;
  source: 'api' | 'worker';
  eventType: string;
  errorCode: string | null;
  severity: 'warning' | 'error' | 'critical';
  detail: Record<string, unknown>;
  jobId?: string | null;
  route?: string | null;
  jobType?: string | null;
}

/**
 * Records a structured operational failure. Writes through the service pool: a
 * failure can happen before a caller identity exists (auth errors, pre-workspace
 * 500s), and the writer must not itself be subject to the fence it is reporting on.
 * Callers treat this as best-effort — capture must never break the request path.
 */
export async function dbRecordOpsEvent(input: OpsEventInput): Promise<void> {
  await queryService(
    `INSERT INTO octo.ops_events
       (workspace_id, source, event_type, error_code, severity, detail, job_id, route, job_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.workspaceId,
      input.source,
      input.eventType,
      input.errorCode,
      input.severity,
      JSON.stringify(input.detail),
      input.jobId ?? null,
      input.route ?? null,
      input.jobType ?? null,
    ]
  );
}

/** Recent operational events for a workspace, newest first, optionally by error code. */
export async function dbListOpsEvents(
  workspaceId: string,
  errorCode: string | null,
  limit = 100
): Promise<
  {
    id: string;
    source: string;
    eventType: string;
    errorCode: string | null;
    severity: string;
    detail: Record<string, unknown>;
    jobId: string | null;
    route: string | null;
    jobType: string | null;
    createdAt: string;
  }[]
> {
  const params: unknown[] = [workspaceId];
  let filter = 'workspace_id = $1';
  if (errorCode) {
    params.push(errorCode);
    filter += ` AND error_code = $${params.length}`;
  }
  params.push(limit);
  return query(
    `SELECT id, source, event_type AS "eventType", error_code AS "errorCode", severity,
            detail, job_id AS "jobId", route, job_type AS "jobType", created_at AS "createdAt"
     FROM octo.ops_events
     WHERE ${filter}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params
  );
}

// 6. Retrieval Operations (Slice 8)
export async function dbEnsureEmbeddingConfig(
  workspaceId: string,
  model: string,
  modelVersion: string,
  dimensions: number,
  chunker: string,
  chunkSize: number,
  chunkOverlap: number
): Promise<string> {
  const sql = `
    INSERT INTO octo.embedding_configs
      (workspace_id, model, model_version, dimensions, chunker, chunk_size, chunk_overlap)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (workspace_id, model, model_version, chunker, chunk_size, chunk_overlap)
    DO NOTHING
    RETURNING id;
  `;
  const inserted = await query<{ id: string }>(sql, [
    workspaceId, model, modelVersion, dimensions, chunker, chunkSize, chunkOverlap,
  ]);
  if (inserted[0]) return inserted[0].id;

  const existing = await query<{ id: string }>(
    `SELECT id FROM octo.embedding_configs
     WHERE workspace_id = $1 AND model = $2 AND model_version = $3
       AND chunker = $4 AND chunk_size = $5 AND chunk_overlap = $6`,
    [workspaceId, model, modelVersion, chunker, chunkSize, chunkOverlap]
  );
  return existing[0]!.id;
}

/**
 * Registers an immutable document version. A repeat of the same content hash
 * returns the existing version instead of creating a duplicate.
 */
export async function dbUpsertDocumentVersion(
  workspaceId: string,
  title: string,
  contentHash: string,
  mimeType: string,
  byteSize: number,
  extractedText: string,
  createdBy: string
): Promise<{ versionId: string; documentId: string; created: boolean }> {
  const docSql = `
    INSERT INTO octo.documents (workspace_id, title, created_by)
    VALUES ($1, $2, $3)
    ON CONFLICT (workspace_id, title) DO NOTHING
    RETURNING id;
  `;
  const docInserted = await query<{ id: string }>(docSql, [workspaceId, title, createdBy]);
  let documentId = docInserted[0]?.id;

  if (!documentId) {
    const found = await query<{ id: string }>(
      'SELECT id FROM octo.documents WHERE workspace_id = $1 AND title = $2',
      [workspaceId, title]
    );
    documentId = found[0]!.id;
  }

  const versionSql = `
    INSERT INTO octo.document_versions
      (document_id, workspace_id, version_number, content_hash, mime_type, byte_size,
       extracted_text, extraction_status)
    VALUES (
      $1, $2,
      COALESCE((SELECT MAX(version_number) + 1 FROM octo.document_versions WHERE document_id = $1), 1),
      $3, $4, $5, $6, 'extracted'
    )
    ON CONFLICT (document_id, content_hash) DO NOTHING
    RETURNING id;
  `;
  const versionInserted = await query<{ id: string }>(versionSql, [
    documentId, workspaceId, contentHash, mimeType, byteSize, extractedText,
  ]);

  if (versionInserted[0]) {
    return { versionId: versionInserted[0].id, documentId, created: true };
  }

  const existing = await query<{ id: string }>(
    'SELECT id FROM octo.document_versions WHERE document_id = $1 AND content_hash = $2',
    [documentId, contentHash]
  );
  return { versionId: existing[0]!.id, documentId, created: false };
}

/** Writes chunks and embeddings for a version, replacing any prior derived rows. */
export async function dbReplaceChunksAndEmbeddings(
  workspaceId: string,
  versionId: string,
  configId: string,
  chunks: Array<{ chunkIndex: number; chunkKey: string; content: string; startOffset: number; endOffset: number; tokenEstimate: number }>,
  vectors: number[][]
): Promise<number> {
  // Derived artifacts are rebuilt as a unit so a partial run cannot leave a
  // half-indexed version.
  await query('DELETE FROM octo.embeddings WHERE workspace_id = $1 AND chunk_id IN (SELECT id FROM octo.chunks WHERE document_version_id = $2)', [workspaceId, versionId]);
  await query('DELETE FROM octo.chunks WHERE document_version_id = $1', [versionId]);

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i]!;
    const inserted = await query<{ id: string }>(
      `INSERT INTO octo.chunks
         (workspace_id, document_version_id, config_id, chunk_index, chunk_key, content,
          start_offset, end_offset, token_estimate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [workspaceId, versionId, configId, chunk.chunkIndex, chunk.chunkKey, chunk.content,
       chunk.startOffset, chunk.endOffset, chunk.tokenEstimate]
    );
    const chunkId = inserted[0]!.id;
    const vectorLiteral = `[${(vectors[i] ?? []).join(',')}]`;
    await query(
      `INSERT INTO octo.embeddings (workspace_id, chunk_id, config_id, embedding)
       VALUES ($1, $2, $3, $4::vector)`,
      [workspaceId, chunkId, configId, vectorLiteral]
    );
  }

  return chunks.length;
}

/** Workspace-scoped semantic retrieval. The filter is applied in SQL. */
export async function dbMatchChunks(
  workspaceId: string,
  queryVector: number[],
  matchCount = 10,
  minSimilarity = 0
): Promise<
  Array<{
    chunkId: string;
    documentVersionId: string;
    content: string;
    chunkIndex: number;
    similarity: number;
    model: string;
    modelVersion: string;
    chunker: string;
  }>
> {
  const literal = `[${queryVector.join(',')}]`;
  return query(
    `SELECT chunk_id AS "chunkId", document_version_id AS "documentVersionId", content,
            chunk_index AS "chunkIndex", similarity, model, model_version AS "modelVersion", chunker
     FROM octo.match_chunks($1, $2::vector, $3, $4)`,
    [workspaceId, literal, matchCount, minSimilarity]
  );
}

// 6. Workspace data plane (Slice 13): atomic workspace create, delete, and the
// confirmation/retention helpers. Kept together so the multi-write invariant in
// dbCreateWorkspaceAtomic is easy to audit.

export async function dbGetWorkspaceById(workspaceId: string): Promise<{
  id: string;
  slug: string;
  name: string;
  description: string | null;
  retentionDays: number | null;
} | null> {
  const rows = await query<{
    id: string;
    slug: string;
    name: string;
    description: string | null;
    retentionDays: number | null;
  }>(
    `SELECT id, slug, name, description, retention_days AS "retentionDays"
     FROM octo.workspaces WHERE id = $1`,
    [workspaceId]
  );
  return rows[0] ?? null;
}

/** Thrown by dbCreateWorkspaceAtomic when the Slice 16 rolling-day quota is spent. */
export const WORKSPACE_DAILY_LIMIT = 'WORKSPACE_DAILY_LIMIT';

/**
 * Creates a workspace, the creator's owner membership, and the workspace-scoped
 * API key in one transaction. A failure in any of the three rolls back all of
 * them, so a workspace can never exist without its key.
 *
 * When `enforceDailyLimit` is set, the Slice 16 quota is enforced *inside* the
 * same transaction, under a per-principal advisory lock. The count and the
 * insert must be atomic: checking the quota on one connection and inserting on
 * another lets two concurrent creates both observe an empty window and both
 * succeed. The lock serializes creates by one principal so the second sees the
 * first's row. The platform owner passes `enforceDailyLimit: false`.
 */
export async function dbCreateWorkspaceAtomic(params: {
  workspaceId: string;
  slug: string;
  name: string;
  description: string | null;
  retentionDays: number | null;
  createdBy: string;
  keyId: string;
  keyHash: string;
  keyPrefix: string;
  keyName: string;
  keyScopes: string[];
  enforceDailyLimit: boolean;
}): Promise<{ id: string; slug: string; name: string; description: string | null; retentionDays: number | null }> {
  return withTransaction(async (client) => {
    if (params.enforceDailyLimit) {
      // Serialize concurrent creates by this principal for the life of the
      // transaction. The lock releases on COMMIT/ROLLBACK.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [params.createdBy]);
      const existing = await client.query(
        `SELECT count(*)::text AS count FROM octo.workspaces
         WHERE created_by = $1 AND auto_provisioned = false
           AND created_at >= now() - interval '24 hours'`,
        [params.createdBy]
      );
      const createdLastDay = parseInt((existing.rows[0] as { count: string }).count, 10);
      if (createdLastDay >= 1) {
        const err = new Error(WORKSPACE_DAILY_LIMIT);
        (err as { code?: string }).code = WORKSPACE_DAILY_LIMIT;
        throw err;
      }
    }

    const ws = await client.query(
      `INSERT INTO octo.workspaces (id, slug, name, description, created_by, retention_days)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, slug, name, description, retention_days AS "retentionDays"`,
      [params.workspaceId, params.slug, params.name, params.description, params.createdBy, params.retentionDays]
    );
    const row = ws.rows[0] as {
      id: string;
      slug: string;
      name: string;
      description: string | null;
      retentionDays: number | null;
    };

    await client.query(
      `INSERT INTO octo.workspace_memberships (workspace_id, principal_id, role)
       VALUES ($1, $2, 'owner')`,
      [params.workspaceId, params.createdBy]
    );

    await client.query(
      `INSERT INTO octo.api_keys (id, key_hash, prefix, name, principal_id, workspace_id, role, scopes)
       VALUES ($1, $2, $3, $4, $5, $6, 'owner', $7)`,
      [
        params.keyId,
        params.keyHash,
        params.keyPrefix,
        params.keyName,
        params.createdBy,
        params.workspaceId,
        params.keyScopes,
      ]
    );

    return row;
  });
}

// 6b. Provisioned databases (productization Slice 13). The catalog row is tenant
// data and runs on the fenced app pool like every other user-data read/write; the
// privileged DDL itself lives in src/server/provisioning.ts.

export interface DbWorkspaceDatabaseRow {
  id: string;
  workspaceId: string;
  dbName: string;
  roleName: string;
  status: string;
  createdAt: string;
}

const WORKSPACE_DATABASE_COLUMNS = `
  id, workspace_id AS "workspaceId", db_name AS "dbName", role_name AS "roleName",
  status, created_at AS "createdAt"
`;

/** The workspace's provisioned database, or null when it has none. */
export async function dbGetWorkspaceDatabase(workspaceId: string): Promise<DbWorkspaceDatabaseRow | null> {
  const rows = await query<DbWorkspaceDatabaseRow>(
    `SELECT ${WORKSPACE_DATABASE_COLUMNS} FROM octo.workspace_databases WHERE workspace_id = $1`,
    [workspaceId]
  );
  return rows[0] ?? null;
}

/** Records a provisioned database. Written last, so a failed provision leaves no row. */
export async function dbInsertWorkspaceDatabase(
  id: string,
  workspaceId: string,
  dbName: string,
  roleName: string,
  createdBy: string
): Promise<DbWorkspaceDatabaseRow> {
  const rows = await query<DbWorkspaceDatabaseRow>(
    `INSERT INTO octo.workspace_databases (id, workspace_id, db_name, role_name, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${WORKSPACE_DATABASE_COLUMNS}`,
    [id, workspaceId, dbName, roleName, createdBy]
  );
  return rows[0]!;
}

/** Files in a transient archive state block a workspace delete. */
export async function dbCountTransientFiles(workspaceId: string): Promise<number> {
  const rows = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM octo.files
     WHERE workspace_id = $1 AND archive_state IN ('archiving', 'restoring')`,
    [workspaceId]
  );
  return parseInt(rows[0]?.count ?? '0', 10);
}

/** Storage keys for a workspace's files, so a delete can report orphaned bytes. */
export async function dbListWorkspaceStorageKeys(workspaceId: string): Promise<string[]> {
  const rows = await query<{ storageKey: string }>(
    `SELECT storage_key AS "storageKey" FROM octo.files WHERE workspace_id = $1`,
    [workspaceId]
  );
  return rows.map((r) => r.storageKey);
}

/**
 * Deletes a workspace inside one transaction. Re-checks the transient archive
 * state under the transaction so a concurrent archive cannot slip past the
 * route's pre-check and orphan bytes. Returns false when the workspace is busy.
 */
export async function dbDeleteWorkspaceAtomic(workspaceId: string): Promise<boolean> {
  return withTransaction(async (client) => {
    const busy = await client.query(
      `SELECT count(*)::int AS count FROM octo.files
       WHERE workspace_id = $1 AND archive_state IN ('archiving', 'restoring')`,
      [workspaceId]
    );
    if (((busy.rows[0] as { count: number }).count ?? 0) > 0) return false;
    await client.query('DELETE FROM octo.workspaces WHERE id = $1', [workspaceId]);
    return true;
  });
}

export async function dbSetConfirmSecret(principalId: string, hash: string): Promise<void> {
  // principals_update_own keys on auth.uid(), which the fence path no longer sets
  // (identity is bound by principal id instead). The confirm secret is per-principal
  // and the caller is already authenticated, so this identity-maintenance write runs
  // on the trusted path rather than widening the principals UPDATE policy.
  await queryService('UPDATE octo.principals SET confirm_secret_hash = $1, updated_at = now() WHERE id = $2', [
    hash,
    principalId,
  ]);
}

export async function dbGetConfirmSecretHash(principalId: string): Promise<string | null> {
  const rows = await queryService<{ hash: string | null }>(
    'SELECT confirm_secret_hash AS hash FROM octo.principals WHERE id = $1',
    [principalId]
  );
  return rows[0]?.hash ?? null;
}

export interface MfaRecord {
  secretEncrypted: string;
  confirmedAt: string | null;
  recoveryCodeHashes: string[];
}

/**
 * The principal's MFA record, or null when none is enrolled. Reads the trusted
 * path like the confirmation secret: this is per-principal identity material,
 * never tenant data exposed to the client.
 */
export async function dbGetMfa(principalId: string): Promise<MfaRecord | null> {
  const rows = await queryService<{ secret: string | null; confirmedAt: string | null; hashes: string[] | null }>(
    `SELECT mfa_secret_encrypted AS secret, mfa_confirmed_at AS "confirmedAt", mfa_recovery_code_hashes AS hashes
     FROM octo.principals WHERE id = $1`,
    [principalId]
  );
  const row = rows[0];
  if (!row?.secret) return null;
  return {
    secretEncrypted: row.secret,
    confirmedAt: row.confirmedAt,
    recoveryCodeHashes: row.hashes ?? [],
  };
}

/** Stores an unconfirmed enrollment secret, clearing any prior confirmation. */
export async function dbSetMfaPending(principalId: string, secretEncrypted: string): Promise<void> {
  await queryService(
    `UPDATE octo.principals
     SET mfa_secret_encrypted = $1, mfa_confirmed_at = NULL, mfa_recovery_code_hashes = '{}', updated_at = now()
     WHERE id = $2`,
    [secretEncrypted, principalId]
  );
}

/** Confirms enrollment and installs the initial recovery-code hashes. */
export async function dbConfirmMfa(principalId: string, recoveryCodeHashes: string[]): Promise<void> {
  await queryService(
    `UPDATE octo.principals
     SET mfa_confirmed_at = now(), mfa_recovery_code_hashes = $1, updated_at = now()
     WHERE id = $2`,
    [recoveryCodeHashes, principalId]
  );
}

/** Replaces the recovery-code hashes (after a code is consumed or rotated). */
export async function dbSetMfaRecoveryCodes(principalId: string, recoveryCodeHashes: string[]): Promise<void> {
  await queryService(
    'UPDATE octo.principals SET mfa_recovery_code_hashes = $1, updated_at = now() WHERE id = $2',
    [recoveryCodeHashes, principalId]
  );
}

/**
 * Atomically consumes one recovery code, returning whether it was present. The
 * single UPDATE removes the hash only when it is still in the list, so two
 * concurrent step-ups cannot both redeem the same code: the second re-reads the
 * row after the first's lock and finds the hash already gone.
 */
export async function dbConsumeMfaRecoveryCode(principalId: string, codeHash: string): Promise<boolean> {
  const rows = await queryService<{ id: string }>(
    `UPDATE octo.principals
     SET mfa_recovery_code_hashes = array_remove(mfa_recovery_code_hashes, $1), updated_at = now()
     WHERE id = $2 AND $1 = ANY(mfa_recovery_code_hashes)
     RETURNING id`,
    [codeHash, principalId]
  );
  return rows.length > 0;
}

/** Removes the MFA record entirely (disable). */
export async function dbClearMfa(principalId: string): Promise<void> {
  await queryService(
    `UPDATE octo.principals
     SET mfa_secret_encrypted = NULL, mfa_confirmed_at = NULL, mfa_recovery_code_hashes = '{}', updated_at = now()
     WHERE id = $1`,
    [principalId]
  );
}

/** The id of a principal's account-wide key, or null. Enforces the one-key rule. */
export async function dbGetAccountWideKeyId(principalId: string): Promise<string | null> {
  // An account-wide key has workspace_id NULL by definition, so a scoped key's fence
  // would hide it. This is a pre-mint existence check for the one-key rule, not tenant
  // data; it reads the caller's own key row on the trusted path.
  const rows = await queryService<{ id: string }>(
    'SELECT id FROM octo.api_keys WHERE principal_id = $1 AND workspace_id IS NULL LIMIT 1',
    [principalId]
  );
  return rows[0]?.id ?? null;
}

/** Workspaces that have a retention window set, for the archive sweep. */
export async function dbListRetentionWorkspaces(): Promise<{ id: string; retentionDays: number }[]> {
  return queryService<{ id: string; retentionDays: number }>(
    `SELECT id, retention_days AS "retentionDays" FROM octo.workspaces
     WHERE retention_days IS NOT NULL`
  );
}

/** Active R2 files older than the retention window, candidates for archiving. */
export async function dbListAgedActiveFiles(workspaceId: string, retentionDays: number): Promise<string[]> {
  const rows = await queryService<{ id: string }>(
    `SELECT id FROM octo.files
     WHERE workspace_id = $1 AND status = 'active' AND archive_state = 'active_r2'
       AND created_at < now() - ($2 || ' days')::interval`,
    [workspaceId, retentionDays]
  );
  return rows.map((r) => r.id);
}

/**
 * True when a job of this type for this file is still open (queued or running).
 * The retention sweep uses it to avoid double-queueing a file that is already
 * mid-transition.
 */
export async function dbHasOpenFileJob(
  workspaceId: string,
  jobType: string,
  fileId: string
): Promise<boolean> {
  const rows = await queryService<{ open: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM octo.jobs
       WHERE workspace_id = $1 AND job_type = $2 AND payload->>'fileId' = $3
         AND state IN ('queued', 'running')
     ) AS open`,
    [workspaceId, jobType, fileId]
  );
  return rows[0]?.open ?? false;
}
