/**
 * Octo Full-Stack Platform Server
 *
 * Exposes REST APIs, API Gateway, and Cloudflare R2 active storage connector.
 * Executes all data mutations directly in PostgreSQL and Cloudflare R2.
 */

import * as fs from 'fs';
import * as path from 'path';

// Conditionally load .env if present (local dev) without failing in CI
if (fs.existsSync('.env') && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile('.env');
}
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { randomBytes, randomUUID } from 'crypto';
import { loadR2ConfigFromEnv, R2StorageProvider } from '../storage/r2-client';
import { LocalObjectStore, ObjectStore, R2ObjectStore } from '../storage/object-store';
import { GoogleDriveProvider, loadGoogleDriveConfigFromEnv } from '../storage/google-drive-provider';
import {
  ArchiveDeps,
  ArchiveFileRecord,
  ArchiveState,
  archiveFile,
  restoreFile,
} from '../storage/archive-service';
import { ensureThumbnail } from '../media/thumbnail-service';
import { signMediaUrl, verifyMediaToken } from '../media/media-token';
import { hashShareToken } from '../media/share-service';
import { JobOutcome, processJob } from '../jobs/worker';
import { AUTH_GUIDANCE, capabilitiesForScopes, hasScope, OctoScope } from '../api/capabilities';
import { chunkKey, chunkText, contentHash, extractText } from '../rag/pipeline';
import { embedTexts, loadEmbeddingConfigFromEnv } from '../rag/embeddings';
import { hashApiKeySecret } from '../api/keys';
import {
  dbDeleteFile,
  dbGetArchiveRecord,
  dbGetAuthorizedWorkspaces,
  dbGetFile,
  dbGetWorkspaceMembership,
  dbInsertApiKey,
  dbInsertFile,
  dbInsertGuestPrincipal,
  dbInsertMembership,
  dbInsertWorkspace,
  dbListApiKeys,
  dbClaimJob,
  dbCompleteJob,
  dbEnsureEmbeddingConfig,
  dbMatchChunks,
  dbReplaceChunksAndEmbeddings,
  dbUpsertDocumentVersion,
  dbEnqueueJob,
  dbFailJob,
  dbListActivity,
  dbListJobs,
  dbListShares,
  dbListWorkspaceFiles,
  dbRecordActivity,
  dbResolveShareById,
  dbResolveShareByTokenHash,
  dbRevokeShare,
  dbInsertShare,
  dbUpdateArchiveState,
  dbVerifyApiKey,
  query,
  testDbConnection,
} from './db';
import { Principal, WorkspaceRole } from '../types/auth';

const PORT = parseInt(process.env['PORT'] ?? '3001', 10);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Explicit opt-in local storage backend for CI/dev only. Production default is R2
// and fails closed when credentials are absent, so uploads can never silently land
// outside R2 and leave octo.files rows pointing at objects that do not exist.
const LOCAL_STORAGE_ROOT = path.join('/tmp', 'octo-storage');
const useLocalStorage = process.env['OCTO_STORAGE_BACKEND'] === 'local';

// Initialize R2 Active Storage Provider
let r2Provider: R2StorageProvider | null = null;
try {
  const r2Config = loadR2ConfigFromEnv();
  r2Provider = new R2StorageProvider(r2Config);
} catch (e) {
  if (useLocalStorage) {
    console.warn('Local storage backend active; R2 disabled:', (e as Error).message);
  } else {
    console.warn('R2 storage initialization note:', (e as Error).message);
  }
}

// Backend-agnostic store used by uploads and derived thumbnail artifacts.
const objectStore: ObjectStore | null = r2Provider
  ? new R2ObjectStore(r2Provider)
  : useLocalStorage
    ? new LocalObjectStore(LOCAL_STORAGE_ROOT)
    : null;

// Cold/archival tier (Slice 5). Optional: archival is simply unavailable when
// Drive credentials are absent, rather than half-configured.
let driveProvider: GoogleDriveProvider | null = null;
try {
  driveProvider = new GoogleDriveProvider(loadGoogleDriveConfigFromEnv());
} catch (e) {
  console.warn('Google Drive archival disabled:', (e as Error).message);
}

/**
 * Archive lifecycle wiring for the worker and the on-demand restore path. Null
 * when either tier is unavailable, so callers fail closed instead of guessing.
 */
const archiveDeps: ArchiveDeps | null =
  objectStore && driveProvider
    ? {
        active: objectStore,
        archive: driveProvider,
        updateFile: (fileId, patch) =>
          dbUpdateArchiveState(fileId, {
            archiveState: patch.archiveState,
            ...(patch.archiveProvider !== undefined ? { archiveProvider: patch.archiveProvider } : {}),
            ...(patch.archiveLocator !== undefined ? { archiveLocator: patch.archiveLocator } : {}),
            ...(patch.archiveHash !== undefined ? { archiveHash: patch.archiveHash } : {}),
            ...(patch.archivedAt !== undefined ? { archivedAt: patch.archivedAt } : {}),
            ...(patch.lastVerifiedAt !== undefined ? { lastVerifiedAt: patch.lastVerifiedAt } : {}),
          }),
      }
    : null;

async function loadArchiveRecord(
  workspaceId: string,
  fileId: string
): Promise<ArchiveFileRecord | null> {
  const row = await dbGetArchiveRecord(workspaceId, fileId);
  if (!row) return null;
  return {
    fileId: row.fileId,
    workspaceId: row.workspaceId,
    name: row.name,
    mimeType: row.mimeType,
    storageKey: row.storageKey,
    archiveState: row.archiveState as ArchiveState,
    archiveLocator: row.archiveLocator,
    archiveHash: row.archiveHash,
  };
}

/**
 * Ensures a file's bytes are present in the active tier, restoring them from the
 * cold tier first when the file has been archived. Returns the bytes, or null
 * when they are unavailable. This is what lets an archived image still open
 * through its unchanged logical file id.
 */
async function ensureActiveBytes(
  workspaceId: string,
  file: { id: string; storageKey: string; archiveState: string }
): Promise<Buffer | null> {
  if (!objectStore) return null;

  const direct = await objectStore.get(file.storageKey);
  if (direct) return direct;

  if (file.archiveState !== 'archived_drive' || !archiveDeps) return null;

  const record = await loadArchiveRecord(workspaceId, file.id);
  if (!record) return null;

  const result = await restoreFile(archiveDeps, record);
  if (!result.ok) {
    console.warn(`On-demand restore failed for ${file.id}: ${result.summary}`);
    return null;
  }

  return objectStore.get(file.storageKey);
}

// Helper: send JSON response
function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(data));
}

// Helper: read request body with Promise.withResolvers
async function readBody(req: IncomingMessage): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => resolve(body));
  req.on('error', reject);
  return promise;
}

interface AuthContext {
  principal: Principal;
  apiKey?: {
    keyId: string;
    prefix: string;
    name: string;
    workspaceId: string | null;
    role: string | null;
    scopes: string[];
    isAccountWide: boolean;
  };
}

// Helper: authenticate caller from Authorization header
async function authenticateRequest(req: IncomingMessage): Promise<AuthContext | null> {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice(7).trim();

  // 1. Check if token is an API key (octo_live_...)
  if (token.startsWith('octo_live_')) {
    const keyHash = hashApiKeySecret(token);
    const verified = await dbVerifyApiKey(keyHash);
    if (!verified) return null;

    // Resolve principal
    const rows = await query<{
      id: string;
      auth_user_id: string;
      email: string;
      display_name: string | null;
      is_guest: boolean;
      is_platform_owner: boolean;
    }>(
      'SELECT id, auth_user_id, email, display_name, is_guest, is_platform_owner FROM octo.principals WHERE id = $1',
      [verified.principalId]
    );

    if (rows.length === 0) return null;
    const pRow = rows[0]!;

    const principal: Principal = {
      id: pRow.id,
      authUserId: pRow.auth_user_id,
      email: pRow.email,
      displayName: pRow.display_name,
      avatarUrl: null,
      isPlatformOwner: pRow.is_platform_owner,
      isGuest: pRow.is_guest,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return {
      principal,
      apiKey: {
        keyId: verified.keyId,
        prefix: verified.prefix,
        name: verified.keyName,
        workspaceId: verified.workspaceId,
        role: verified.role,
        scopes: verified.scopes,
        isAccountWide: verified.workspaceId === null,
      },
    };
  }

  // 2. Direct session / principal ID token (e.g. from guest login).
  // Shape-check before querying so a malformed token returns 401 rather than
  // surfacing a Postgres uuid cast error as a 500.
  if (!UUID_PATTERN.test(token)) {
    return null;
  }

  const rows = await query<{
    id: string;
    auth_user_id: string;
    email: string;
    display_name: string | null;
    is_guest: boolean;
    is_platform_owner: boolean;
  }>(
    'SELECT id, auth_user_id, email, display_name, is_guest, is_platform_owner FROM octo.principals WHERE id = $1',
    [token]
  );

  if (rows.length === 0) return null;
  const pRow = rows[0]!;

  return {
    principal: {
      id: pRow.id,
      authUserId: pRow.auth_user_id,
      email: pRow.email,
      displayName: pRow.display_name,
      avatarUrl: null,
      isPlatformOwner: pRow.is_platform_owner,
      isGuest: pRow.is_guest,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}

interface MediaAuthorization {
  principalId: string;
  workspaceId: string;
  fileId: string;
}

/**
 * Authorizes a media request either by bearer credential or by a signed media URL
 * token (image/video tags cannot send Authorization headers). The signature is
 * scoped to one file + workspace + principal, so it cannot be replayed elsewhere.
 */
async function authorizeMediaRequest(
  req: IncomingMessage,
  url: URL
): Promise<MediaAuthorization | null> {
  const bearer = await authenticateRequest(req);
  if (bearer) {
    const workspaceId = url.searchParams.get('workspaceId');
    const fileId = url.searchParams.get('fileId');
    if (!workspaceId || !fileId) return null;
    const mem = await dbGetWorkspaceMembership(workspaceId, bearer.principal.id);
    if (!mem) return null;
    return { principalId: bearer.principal.id, workspaceId, fileId };
  }

  const claims = verifyMediaToken(url.searchParams);
  if (!claims) return null;

  if (claims.kind === 'principal') {
    // Membership is still re-checked, so revoking access invalidates live tokens.
    const mem = await dbGetWorkspaceMembership(claims.workspaceId, claims.principalId);
    if (!mem) return null;
    return {
      principalId: claims.principalId,
      workspaceId: claims.workspaceId,
      fileId: claims.fileId,
    };
  }

  // Share-scoped media: the share must still be active. Revoking or expiring the
  // link therefore also invalidates every media URL it signed.
  const share = await dbResolveShareById(claims.shareId);
  if (!share || share.workspaceId !== claims.workspaceId) return null;

  return {
    principalId: share.createdBy,
    workspaceId: claims.workspaceId,
    fileId: claims.fileId,
  };
}

/**
 * Runs one drain pass of the job queue against the server's storage backend.
 * The worker uses the same lease-based claim as a standalone process, so a crash
 * between claim and completion leaves the job claimable again after the lease.
 */
async function drainQueueOnce(maxJobs = 10): Promise<JobOutcome[]> {
  const outcomes: JobOutcome[] = [];

  for (let i = 0; i < maxJobs; i += 1) {
    const job = await dbClaimJob('octo-server-worker', 60);
    if (!job) break;

    const outcome = await processJob(job, {
      claim: async () => null,
      store: objectStore!,
      complete: async (jobId, result) => {
        await dbCompleteJob(jobId, result);
      },
      fail: async (claimed, code, summary, retryable) => {
        await dbFailJob(claimed.jobId, claimed.attempt, 3, code, summary, retryable);
      },
      activity: async (claimed, summary) => {
        await dbRecordActivity(claimed.workspaceId, 'job.transition', summary, claimed.jobId);
      },
      archive: archiveDeps ?? undefined,
      loadArchiveTarget: archiveDeps ? loadArchiveRecord : undefined,
    });

    outcomes.push(outcome);
  }

  return outcomes;
}

/**
 * Enforces a token scope. Human sessions carry no scope list and are not limited
 * here; API-key callers must hold the required scope or the call is refused.
 */
function requireScope(auth: AuthContext, scope: OctoScope): boolean {
  if (!auth.apiKey) return true;
  return hasScope(auth.apiKey.scopes, scope);
}

/** Standard refusal body for a missing scope. */
function scopeDenied(res: ServerResponse, scope: OctoScope): void {
  sendJson(res, 403, { error: `FORBIDDEN: Token is missing the required '${scope}' scope` });
}

/** Attributes an agent action to its principal for audit. Best-effort. */
async function attributeAgentAction(
  auth: AuthContext,
  workspaceId: string,
  eventType: string,
  summary: string
): Promise<void> {
  if (!auth.apiKey) return;
  try {
    await dbRecordActivity(workspaceId, eventType, summary, null, auth.principal.id);
  } catch {
    // Audit attribution must never break the request path.
  }
}

export const server = createServer(async (req, res) => {
  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const pathname = url.pathname;

  try {
    // 1. Health check (tests both PostgreSQL and Cloudflare R2 connections)
    if (pathname === '/health' && req.method === 'GET') {
      const dbStatus = await testDbConnection();
      const r2Status = r2Provider ? await r2Provider.testConnection() : { connected: false, bucket: 'none' };
      sendJson(res, 200, {
        status: 'ok',
        version: '0.1.0',
        database: dbStatus,
        r2: r2Status,
        googleAuthEnabled: Boolean(process.env['GOOGLE_OAUTH_CLIENT_ID']),
      });
      return;
    }

    // 1b. Google OAuth start. Reports a clear state instead of a dead 404 when the
    // OAuth client has not been provisioned yet.
    if (pathname === '/api/auth/google' && req.method === 'GET') {
      const clientId = process.env['GOOGLE_OAUTH_CLIENT_ID'];
      if (!clientId) {
        sendJson(res, 501, {
          error:
            'GOOGLE_AUTH_NOT_CONFIGURED: Set GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET, or use Guest access.',
        });
        return;
      }
      const redirectUri = `${url.origin}/api/auth/google/callback`;
      const authorizeUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authorizeUrl.searchParams.set('client_id', clientId);
      authorizeUrl.searchParams.set('redirect_uri', redirectUri);
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('scope', 'openid email profile');
      authorizeUrl.searchParams.set('access_type', 'offline');
      authorizeUrl.searchParams.set('prompt', 'consent');
      res.writeHead(302, { Location: authorizeUrl.toString() });
      res.end();
      return;
    }

    // 2. Guest Login: POST /api/auth/guest
    if (pathname === '/api/auth/guest' && req.method === 'POST') {
      const bodyStr = await readBody(req);
      const parsed = bodyStr ? JSON.parse(bodyStr) : {};
      const displayName = parsed.displayName ?? 'Guest User';

      const guestId = randomUUID();
      const guestSlug = `guest-${guestId.slice(0, 8)}`;
      const email = `${guestSlug}@octo.local`;

      // Insert guest principal in PostgreSQL
      const principal = await dbInsertGuestPrincipal(guestId, guestId, email, displayName);

      // Auto-provision Personal (Guest) workspace in PostgreSQL
      const workspaceId = randomUUID();
      const workspace = await dbInsertWorkspace(
        workspaceId,
        guestSlug,
        'Personal (Guest)',
        'Auto-provisioned personal sandbox workspace',
        principal.id
      );

      // Insert owner membership in PostgreSQL
      await dbInsertMembership(workspace.id, principal.id, 'owner');

      sendJson(res, 201, {
        principal: {
          id: principal.id,
          email: principal.email,
          displayName: principal.displayName,
          isGuest: true,
          isPlatformOwner: false,
        },
        workspace: {
          id: workspace.id,
          slug: workspace.slug,
          name: workspace.name,
          role: 'owner',
        },
        sessionToken: principal.id,
      });
      return;
    }

    // 3. Workspaces: GET /api/workspaces
    if (pathname === '/api/workspaces' && req.method === 'GET') {
      const auth = await authenticateRequest(req);
      if (!auth) {
        sendJson(res, 401, { error: 'UNAUTHENTICATED' });
        return;
      }
      if (!requireScope(auth, 'read')) {
        scopeDenied(res, 'read');
        return;
      }

      // If workspace-scoped key, restrict list to that specific workspace
      if (auth.apiKey && auth.apiKey.workspaceId) {
        const rows = await query<{
          id: string;
          slug: string;
          name: string;
          description: string | null;
        }>('SELECT id, slug, name, description FROM octo.workspaces WHERE id = $1', [
          auth.apiKey.workspaceId,
        ]);

        if (rows.length === 0) {
          sendJson(res, 200, []);
          return;
        }

        const ws = rows[0]!;
        sendJson(res, 200, [
          {
            id: ws.id,
            slug: ws.slug,
            name: ws.name,
            description: ws.description,
            role: auth.apiKey.role ?? 'member',
            isOwner: auth.apiKey.role === 'owner',
          },
        ]);
        return;
      }

      // Account-wide API key or user session: query all authorized workspaces from PostgreSQL
      const workspaces = await dbGetAuthorizedWorkspaces(auth.principal.id);
      sendJson(res, 200, workspaces);
      return;
    }

    // 4. File Catalog: GET /api/files?workspaceId=...
    if (pathname === '/api/files' && req.method === 'GET') {
      const auth = await authenticateRequest(req);
      if (!auth) {
        sendJson(res, 401, { error: 'UNAUTHENTICATED' });
        return;
      }
      if (!requireScope(auth, 'files')) {
        scopeDenied(res, 'files');
        return;
      }

      const workspaceId = url.searchParams.get('workspaceId');
      if (!workspaceId) {
        sendJson(res, 400, { error: 'workspaceId required' });
        return;
      }

      // Enforce workspace-scoped key restrictions
      if (auth.apiKey && auth.apiKey.workspaceId && auth.apiKey.workspaceId !== workspaceId) {
        sendJson(res, 403, { error: 'FORBIDDEN: Key restricted to different workspace' });
        return;
      }

      const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
      if (!mem) {
        sendJson(res, 403, { error: 'FORBIDDEN: Not a member of this workspace' });
        return;
      }

      const files = await dbListWorkspaceFiles(workspaceId);
      sendJson(res, 200, files);
      return;
    }

    // 5. File Upload: POST /api/files/upload
    if (pathname === '/api/files/upload' && req.method === 'POST') {
      const auth = await authenticateRequest(req);
      if (!auth) {
        sendJson(res, 401, { error: 'UNAUTHENTICATED' });
        return;
      }
      if (!requireScope(auth, 'write')) {
        scopeDenied(res, 'write');
        return;
      }

      const bodyStr = await readBody(req);
      const parsed = JSON.parse(bodyStr);
      const { workspaceId, name, mimeType, data, dataEncoding } = parsed;

      if (!workspaceId || !name || data === undefined) {
        sendJson(res, 400, { error: 'workspaceId, name, and data are required' });
        return;
      }

      // Enforce workspace-scoped key restriction
      if (auth.apiKey && auth.apiKey.workspaceId && auth.apiKey.workspaceId !== workspaceId) {
        sendJson(res, 403, { error: 'FORBIDDEN: Key restricted to different workspace' });
        return;
      }

      const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
      if (!mem || (mem.role !== 'owner' && mem.role !== 'admin' && mem.role !== 'operator')) {
        sendJson(res, 403, { error: 'FORBIDDEN: Operator role or higher required to upload' });
        return;
      }

      const fileId = randomUUID();
      const storageKey = `workspaces/${workspaceId}/${fileId}/${name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

      // Upload bytes to Cloudflare R2 (or the explicit local CI/dev backend)
      if (!objectStore) {
        sendJson(res, 503, {
          error:
            'STORAGE_UNAVAILABLE: R2 credentials missing. Set OCTO_STORAGE_BACKEND=local for CI/dev only.',
        });
        return;
      }

      // Binary payloads must declare base64; otherwise the body is treated as
      // UTF-8 text. Storing base64 text as an object body would corrupt every
      // uploaded image and silently break thumbnail generation.
      if (dataEncoding !== undefined && dataEncoding !== 'base64' && dataEncoding !== 'utf8') {
        sendJson(res, 400, { error: "BAD_REQUEST: dataEncoding must be 'base64' or 'utf8'" });
        return;
      }

      const payload =
        dataEncoding === 'base64'
          ? Buffer.from(String(data), 'base64')
          : Buffer.isBuffer(data)
            ? data
            : Buffer.from(String(data), 'utf-8');

      if (payload.byteLength === 0) {
        sendJson(res, 400, { error: 'BAD_REQUEST: decoded payload is empty' });
        return;
      }

      const contentType = mimeType ?? 'application/octet-stream';
      await objectStore.put(storageKey, payload, contentType);
      const sizeBytes = payload.byteLength;
      const etag: string | null = `stored-${payload.byteLength}`;
      // Commit record into PostgreSQL octo.files
      const fileRecord = await dbInsertFile(
        fileId,
        workspaceId,
        auth.principal.id,
        name,
        mimeType ?? 'application/octet-stream',
        sizeBytes,
        storageKey,
        etag?.replace(/"/g, '') ?? null
      );

      await attributeAgentAction(
        auth,
        workspaceId,
        'file.uploaded',
        `File ${name} uploaded by agent principal`
      );
      sendJson(res, 201, fileRecord);
      return;
    }

    // 6. Presigned Download URL: GET /api/files/download
    if (pathname === '/api/files/download' && req.method === 'GET') {
      const auth = await authenticateRequest(req);
      if (!auth) {
        sendJson(res, 401, { error: 'UNAUTHENTICATED' });
        return;
      }

      const fileId = url.searchParams.get('fileId');
      const workspaceId = url.searchParams.get('workspaceId');
      if (!fileId || !workspaceId) {
        sendJson(res, 400, { error: 'fileId and workspaceId required' });
        return;
      }

      const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
      if (!mem) {
        sendJson(res, 403, { error: 'FORBIDDEN: Not a member of this workspace' });
        return;
      }

      const file = await dbGetFile(workspaceId, fileId);
      if (!file) {
        sendJson(res, 404, { error: 'FILE_NOT_FOUND' });
        return;
      }

      const downloadUrl = r2Provider
        ? await r2Provider.generatePresignedDownloadUrl(file.storageKey, 3600)
        : `/api/files/content?fileId=${fileId}&workspaceId=${workspaceId}`;
      sendJson(res, 200, { file, downloadUrl });
      return;
    }
    // 6b. File Content: GET /api/files/content?workspaceId=...&fileId=...
    // Streams bytes for the explicit local storage backend. R2 callers use the
    // presigned URL from /api/files/download instead.
    if (pathname === '/api/files/content' && req.method === 'GET') {
      const auth = await authorizeMediaRequest(req, url);
      if (!auth) {
        sendJson(res, 401, { error: 'UNAUTHENTICATED' });
        return;
      }

      const { fileId, workspaceId } = auth;

      const file = await dbGetFile(workspaceId, fileId);
      if (!file) {
        sendJson(res, 404, { error: 'FILE_NOT_FOUND' });
        return;
      }

      if (!objectStore) {
        sendJson(res, 503, { error: 'STORAGE_UNAVAILABLE: no storage backend configured.' });
        return;
      }

      const bytes = await ensureActiveBytes(workspaceId, file);
      if (!bytes) {
        sendJson(res, 404, { error: 'OBJECT_MISSING: Stored bytes not found for this record.' });
        return;
      }

      res.writeHead(200, {
        'Content-Type': file.mimeType || 'application/octet-stream',
        'Content-Length': String(bytes.byteLength),
        'Access-Control-Allow-Origin': '*',
      });
      res.end(bytes);
      return;
    }

    // 6c. Thumbnail: GET /api/files/thumbnail?workspaceId=...&fileId=...
    // Serves a cached small WebP derivative so grids never fetch full originals.
    if (pathname === '/api/files/thumbnail' && req.method === 'GET') {
      const auth = await authorizeMediaRequest(req, url);
      if (!auth) {
        sendJson(res, 401, { error: 'UNAUTHENTICATED' });
        return;
      }

      const { fileId, workspaceId, principalId } = auth;

      const file = await dbGetFile(workspaceId, fileId);
      if (!file) {
        sendJson(res, 404, { error: 'FILE_NOT_FOUND' });
        return;
      }

      if (!objectStore) {
        sendJson(res, 503, { error: 'STORAGE_UNAVAILABLE: no storage backend configured.' });
        return;
      }

      // A thumbnail needs the original bytes; pull them back from the cold tier
      // first when the file has been archived.
      if (file.archiveState === 'archived_drive' && !(await ensureActiveBytes(workspaceId, file))) {
        sendJson(res, 404, { error: 'OBJECT_MISSING: Archived bytes could not be restored.' });
        return;
      }

      const thumb = await ensureThumbnail(objectStore, fileId, file.storageKey, file.mimeType);

      if (!thumb) {
        // Not an image (or original missing/corrupt): send the caller to the full
        // object instead of inventing a derivative.
        res.writeHead(302, {
          Location: signMediaUrl('/api/files/content', {
            kind: 'principal',
            fileId,
            workspaceId,
            principalId,
          }),
        });
        res.end();
        return;
      }

      res.writeHead(200, {
        'Content-Type': thumb.contentType,
        'Content-Length': String(thumb.bytes.byteLength),
        'Cache-Control': 'private, max-age=3600',
        'X-Octo-Thumbnail-Cache': thumb.cached ? 'hit' : 'miss',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(thumb.bytes);
      return;
    }

    // 7. File Delete: DELETE /api/files/:id
    if (pathname.startsWith('/api/files/') && req.method === 'DELETE') {
      const auth = await authenticateRequest(req);
      if (!auth) {
        sendJson(res, 401, { error: 'UNAUTHENTICATED' });
        return;
      }
      if (!requireScope(auth, 'delete')) {
        scopeDenied(res, 'delete');
        return;
      }

      const fileId = pathname.slice('/api/files/'.length);
      const workspaceId = url.searchParams.get('workspaceId');
      if (!fileId || !workspaceId) {
        sendJson(res, 400, { error: 'fileId and workspaceId required' });
        return;
      }

      const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
      if (!mem || (mem.role !== 'owner' && mem.role !== 'admin')) {
        sendJson(res, 403, { error: 'FORBIDDEN: Owner or admin role required to delete files' });
        return;
      }

      const deleted = await dbDeleteFile(workspaceId, fileId);
      if (!deleted) {
        sendJson(res, 404, { error: 'FILE_NOT_FOUND' });
        return;
      }

      if (objectStore) {
        await objectStore.delete(deleted.storageKey);
      }

      await attributeAgentAction(auth, workspaceId, 'file.deleted', `File ${fileId} deleted by agent principal`);
      sendJson(res, 200, { success: true, fileId });
      return;
    }

    // 7b. Archive / Restore: POST /api/files/:id/archive | /restore
    // Both are queued as jobs rather than executed inline, so the copy-verify-
    // delete ordering runs under the worker's lease and retry accounting.
    if (
      pathname.startsWith('/api/files/') &&
      (pathname.endsWith('/archive') || pathname.endsWith('/restore')) &&
      req.method === 'POST'
    ) {
      const auth = await authenticateRequest(req);
      if (!auth) {
        sendJson(res, 401, { error: 'UNAUTHENTICATED' });
        return;
      }

      const direction = pathname.endsWith('/archive') ? 'archive' : 'restore';
      const suffix = `/${direction}`;
      const fileId = pathname.slice('/api/files/'.length, -suffix.length);
      const workspaceId = url.searchParams.get('workspaceId');
      if (!fileId || !workspaceId) {
        sendJson(res, 400, { error: 'fileId and workspaceId required' });
        return;
      }

      const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
      if (!mem || (mem.role !== 'owner' && mem.role !== 'admin' && mem.role !== 'operator')) {
        sendJson(res, 403, { error: 'FORBIDDEN: Operator role or higher required' });
        return;
      }

      if (!archiveDeps) {
        sendJson(res, 503, {
          error: 'ARCHIVE_UNAVAILABLE: Google Drive archival is not configured on this server.',
        });
        return;
      }

      const file = await dbGetFile(workspaceId, fileId);
      if (!file) {
        sendJson(res, 404, { error: 'FILE_NOT_FOUND' });
        return;
      }

      const jobType = direction === 'archive' ? 'archive_file' : 'restore_file';
      // One in-flight request per (file, direction): a repeat returns the
      // original job instead of queueing a second copy of the same transition.
      const { job, created } = await dbEnqueueJob(
        randomUUID(),
        workspaceId,
        jobType,
        `${direction}:${fileId}`,
        { fileId, storageKey: file.storageKey, mimeType: file.mimeType },
        auth.principal.id
      );

      if (created) {
        await dbRecordActivity(
          workspaceId,
          'file.archive_requested',
          `File ${fileId} ${direction} queued`,
          job.id,
          auth.principal.id
        );
      }

      sendJson(res, 202, { job, created });
      return;
    }

    // 8. Gallery Media: GET /api/gallery?workspaceId=...
    if (pathname === '/api/gallery' && req.method === 'GET') {
      const auth = await authenticateRequest(req);
      if (!auth) {
        sendJson(res, 401, { error: 'UNAUTHENTICATED' });
        return;
      }
      if (!requireScope(auth, 'files')) {
        scopeDenied(res, 'files');
        return;
      }

      const workspaceId = url.searchParams.get('workspaceId');
      if (!workspaceId) {
        sendJson(res, 400, { error: 'workspaceId required' });
        return;
      }

      const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
      if (!mem) {
        sendJson(res, 403, { error: 'FORBIDDEN: Not a member of this workspace' });
        return;
      }

      const allFiles = await dbListWorkspaceFiles(workspaceId);
      const mediaFiles = allFiles.filter(
        (f) => f.mimeType.startsWith('image/') || f.mimeType.startsWith('video/')
      );

      const items = [];
      for (const f of mediaFiles) {
        const claims = {
          kind: 'principal' as const,
          fileId: f.id,
          workspaceId,
          principalId: auth.principal.id,
        };

        // The full view uses the original (presigned R2 URL when available, else the
        // signed content route). The grid always uses the small cached derivative.
        const fullUrl = r2Provider
          ? await r2Provider.generatePresignedDownloadUrl(f.storageKey, 3600)
          : signMediaUrl('/api/files/content', claims);

        const thumbnailUrl = signMediaUrl('/api/files/thumbnail', claims);

        items.push({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
          kind: f.mimeType.startsWith('video/') ? 'video' : 'image',
          thumbnailUrl,
          fullUrl,
          createdAt: f.createdAt,
        });
      }

      sendJson(res, 200, items);
      return;
    }

    // 8. API Keys: GET & POST /api/keys
    if (pathname === '/api/keys' && req.method === 'GET') {
      const auth = await authenticateRequest(req);
      if (!auth) {
        sendJson(res, 401, { error: 'UNAUTHENTICATED' });
        return;
      }

      const keys = await dbListApiKeys(auth.principal.id);
      sendJson(
        res,
        200,
        keys.map((k) => ({
          ...k,
          isAccountWide: k.workspaceId === null,
        }))
      );
      return;
    }

    if (pathname === '/api/keys' && req.method === 'POST') {
      const auth = await authenticateRequest(req);
      if (!auth) {
        sendJson(res, 401, { error: 'UNAUTHENTICATED' });
        return;
      }

      const bodyStr = await readBody(req);
      const parsed = JSON.parse(bodyStr);
      const { name, workspaceId, scopes: requestedScopes } = parsed;

      if (!name) {
        sendJson(res, 400, { error: 'name is required' });
        return;
      }

      // Default is non-destructive: a new token can read and write files but
      // cannot delete anything unless the delete scope is requested explicitly.
      const ALLOWED_SCOPES = ['read', 'write', 'files', 'delete', 'admin'];
      let scopes: string[] = ['read', 'write', 'files'];
      if (requestedScopes !== undefined) {
        if (!Array.isArray(requestedScopes) || requestedScopes.length === 0) {
          sendJson(res, 400, { error: 'BAD_REQUEST: scopes must be a non-empty array' });
          return;
        }
        const unknown = requestedScopes.filter((s: string) => !ALLOWED_SCOPES.includes(s));
        if (unknown.length > 0) {
          sendJson(res, 400, { error: `BAD_REQUEST: unknown scopes: ${unknown.join(', ')}` });
          return;
        }
        scopes = requestedScopes;
      }

      // If workspace-scoped key requested, verify caller belongs to that workspace
      if (workspaceId) {
        const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
        if (!mem) {
          sendJson(res, 403, { error: 'FORBIDDEN: Cannot create API key for non-member workspace' });
          return;
        }
      }

      const isAccountWide = !workspaceId;
      const prefix = isAccountWide ? 'octo_live_acc' : 'octo_live_ws';
      const secretBytes = randomUUID().replace(/-/g, '');
      const rawSecret = `${prefix}_${secretBytes}`;
      const keyHash = hashApiKeySecret(rawSecret);

      // Authority is never asserted by the key:
      //   * account-wide keys carry role NULL, so each call is authorized against
      //     the principal's live memberships;
      //   * workspace-scoped keys are capped at the creator's current role there.
      let keyRole: string | null = null;
      if (workspaceId) {
        const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
        keyRole = mem?.role ?? 'member';
      }

      const keyId = randomUUID();
      await dbInsertApiKey(
        keyId,
        keyHash,
        prefix,
        name,
        auth.principal.id,
        workspaceId ?? null,
        keyRole,
        scopes
      );

      sendJson(res, 201, {
        apiKey: {
          id: keyId,
          prefix,
          name,
          workspaceId: workspaceId ?? null,
          isAccountWide,
          scopes,
        },
        rawSecret,
      });
      return;
    }

    // 8b. Revoke an API key: DELETE /api/keys/:id
    // Without this, a leaked agent token could never be withdrawn.
    if (pathname.startsWith('/api/keys/') && req.method === 'DELETE') {
      const auth = await authenticateRequest(req);
      if (!auth) {
        sendJson(res, 401, { error: 'UNAUTHENTICATED' });
        return;
      }

      const keyId = pathname.slice('/api/keys/'.length);
      if (!keyId) {
        sendJson(res, 400, { error: 'keyId is required' });
        return;
      }

      const rows = await query<{ id: string }>(
        'DELETE FROM octo.api_keys WHERE id = $1 AND principal_id = $2 RETURNING id',
        [keyId, auth.principal.id]
      );

      if (rows.length === 0) {
        sendJson(res, 404, { error: 'KEY_NOT_FOUND: no such key owned by this principal' });
        return;
      }

      sendJson(res, 200, { success: true, keyId });
      return;
    }

    // 9. Scoped share links (Slice 4)
    // Create: POST /api/workspaces/shares
    if (pathname === '/api/workspaces/shares' && req.method === 'POST') {
      const auth = await authenticateRequest(req);
      if (!auth) {
        sendJson(res, 401, { error: 'UNAUTHENTICATED' });
        return;
      }

      const bodyStr = await readBody(req);
      const parsed = JSON.parse(bodyStr);
      const { workspaceId, resourceType, resourceId, permission, expiresInHours, validUntil } = parsed;

      if (!workspaceId) {
        sendJson(res, 400, { error: 'workspaceId is required' });
        return;
      }

      // The server connects as a trusted role, so authorization is enforced here.
      const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
      if (!mem || (mem.role !== 'owner' && mem.role !== 'admin')) {
        sendJson(res, 403, { error: 'FORBIDDEN: Owner or admin role required to create share links' });
        return;
      }

      if (permission && permission !== 'read' && permission !== 'upload') {
        sendJson(res, 400, { error: "BAD_REQUEST: permission must be 'read' or 'upload'" });
        return;
      }

      const rawToken = `octo_share_${randomBytes(32).toString('base64url')}`;
      const tokenHash = hashShareToken(rawToken);
      const tokenPrefix = rawToken.slice(0, 18);

      let expiry: string | null = validUntil ?? null;
      if (!expiry && typeof expiresInHours === 'number' && expiresInHours > 0) {
        const d = new Date();
        d.setHours(d.getHours() + expiresInHours);
        expiry = d.toISOString();
      }

      // Reject a nonsensical expiry with a clear 400 instead of surfacing the
      // database check constraint as an internal error.
      if (expiry) {
        const parsedExpiry = new Date(expiry);
        if (!Number.isFinite(parsedExpiry.getTime())) {
          sendJson(res, 400, { error: 'BAD_REQUEST: validUntil is not a valid timestamp' });
          return;
        }
        if (parsedExpiry.getTime() <= Date.now()) {
          sendJson(res, 400, { error: 'BAD_REQUEST: validUntil must be in the future' });
          return;
        }
      }

      const share = await dbInsertShare(
        randomUUID(),
        workspaceId,
        resourceType ?? 'gallery',
        resourceId ?? null,
        tokenHash,
        tokenPrefix,
        permission ?? 'read',
        expiry,
        auth.principal.id
      );

      // The raw token is returned exactly once and never persisted or logged.
      sendJson(res, 201, {
        share: { ...share, tokenHash: undefined },
        shareUrl: `/share/${rawToken}`,
        rawToken,
      });
      return;
    }

    // List: GET /api/workspaces/shares?workspaceId=...
    if (pathname === '/api/workspaces/shares' && req.method === 'GET') {
      const auth = await authenticateRequest(req);
      if (!auth) {
        sendJson(res, 401, { error: 'UNAUTHENTICATED' });
        return;
      }

      const workspaceId = url.searchParams.get('workspaceId');
      if (!workspaceId) {
        sendJson(res, 400, { error: 'workspaceId is required' });
        return;
      }

      const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
      if (!mem || (mem.role !== 'owner' && mem.role !== 'admin')) {
        sendJson(res, 403, { error: 'FORBIDDEN: Owner or admin role required to list share links' });
        return;
      }

      const shares = await dbListShares(workspaceId);
      sendJson(res, 200, shares);
      return;
    }

    // Revoke: DELETE /api/shares/:id?workspaceId=...
    if (pathname.startsWith('/api/shares/') && req.method === 'DELETE') {
      const auth = await authenticateRequest(req);
      if (!auth) {
        sendJson(res, 401, { error: 'UNAUTHENTICATED' });
        return;
      }

      const shareId = pathname.slice('/api/shares/'.length);
      const workspaceId = url.searchParams.get('workspaceId');
      if (!shareId || !workspaceId) {
        sendJson(res, 400, { error: 'shareId and workspaceId are required' });
        return;
      }

      const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
      if (!mem || (mem.role !== 'owner' && mem.role !== 'admin')) {
        sendJson(res, 403, { error: 'FORBIDDEN: Owner or admin role required to revoke share links' });
        return;
      }

      const revoked = await dbRevokeShare(shareId);
      if (!revoked || revoked.workspaceId !== workspaceId) {
        sendJson(res, 404, { error: 'SHARE_NOT_FOUND' });
        return;
      }

      sendJson(res, 200, { success: true, shareId });
      return;
    }

    // Anonymous public view: GET /api/public/shares/:token
    // Resolves the token to exactly one target resource. No workspace, sibling
    // album, or admin route is reachable with the token alone.
    if (pathname.startsWith('/api/public/shares/') && req.method === 'GET') {
      const rawToken = pathname.slice('/api/public/shares/'.length);
      if (!rawToken) {
        sendJson(res, 400, { error: 'share token is required' });
        return;
      }

      const tokenHash = hashShareToken(rawToken);
      const share = await dbResolveShareByTokenHash(tokenHash);

      // Unknown, revoked, not-yet-valid, and expired all fail identically, so the
      // response cannot be used to probe which links ever existed.
      if (!share) {
        sendJson(res, 404, { error: 'SHARE_NOT_FOUND_OR_INACTIVE' });
        return;
      }

      const mediaFiles = (await dbListWorkspaceFiles(share.workspaceId)).filter(
        (f) => f.mimeType.startsWith('image/') || f.mimeType.startsWith('video/')
      );

      const items = [];
      for (const f of mediaFiles) {
        const claims = {
          kind: 'share' as const,
          fileId: f.id,
          workspaceId: share.workspaceId,
          shareId: share.shareId,
        };

        // Media URLs are capped at the share's own expiry so they cannot outlive it.
        const fullUrl = signMediaUrl('/api/files/content', claims, 3600, share.validUntil);
        const thumbnailUrl = signMediaUrl('/api/files/thumbnail', claims, 3600, share.validUntil);

        items.push({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
          kind: f.mimeType.startsWith('video/') ? 'video' : 'image',
          thumbnailUrl,
          fullUrl,
          createdAt: f.createdAt,
        });
      }

      // Only share-scoped fields are returned: no workspace name, members, or IDs
      // beyond the shared target itself.
      sendJson(res, 200, {
        share: {
          id: share.shareId,
          resourceType: share.resourceType,
          permission: share.permission,
          validUntil: share.validUntil,
        },
        items,
      });
      return;
    }

    // 9b. Capability discovery (Slice 7)
    // Describes HOW to call Octo for the presented token, filtered to the scopes
    // the token actually holds. The description is documentation only: every call
    // is still authorized server-side against the token's scopes.
    if (pathname === '/api/capabilities' && req.method === 'GET') {
      const auth = await authenticateRequest(req);
      if (!auth) {
        sendJson(res, 401, { error: 'UNAUTHENTICATED' });
        return;
      }

      // A session (human) caller is not scope-limited; report the full surface.
      const scopes = auth.apiKey ? auth.apiKey.scopes : ['read', 'write', 'delete', 'files', 'admin'];
      const capabilities = capabilitiesForScopes(scopes);

      sendJson(res, 200, {
        principal: {
          id: auth.principal.id,
          isGuest: auth.principal.isGuest,
          // No email, provider token, or infrastructure credential is disclosed.
        },
        token: auth.apiKey
          ? {
              prefix: auth.apiKey.prefix,
              workspaceId: auth.apiKey.workspaceId,
              isAccountWide: auth.apiKey.isAccountWide,
              scopes: auth.apiKey.scopes,
            }
          : { type: 'session' },
        auth: AUTH_GUIDANCE,
        capabilities,
      });
      return;
    }

    // 10. Operations: jobs and activity (Slice 6)
    // Enqueue: POST /api/jobs
    if (pathname === '/api/jobs' && req.method === 'POST') {
      const auth = await authenticateRequest(req);
      if (!auth) {
        sendJson(res, 401, { error: 'UNAUTHENTICATED' });
        return;
      }
      if (!requireScope(auth, 'write')) {
        scopeDenied(res, 'write');
        return;
      }

      const bodyStr = await readBody(req);
      const parsed = JSON.parse(bodyStr);
      const { workspaceId, jobType, idempotencyKey, payload } = parsed;

      if (!workspaceId || !jobType || !idempotencyKey) {
        sendJson(res, 400, { error: 'workspaceId, jobType, and idempotencyKey are required' });
        return;
      }

      const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
      if (!mem || (mem.role !== 'owner' && mem.role !== 'admin' && mem.role !== 'operator')) {
        sendJson(res, 403, { error: 'FORBIDDEN: Operator role or higher required to enqueue jobs' });
        return;
      }

      // A repeat with the same idempotency key returns the original job.
      const { job, created } = await dbEnqueueJob(
        randomUUID(),
        workspaceId,
        jobType,
        idempotencyKey,
        payload ?? {},
        auth.principal.id
      );

      if (created) {
        await dbRecordActivity(
          workspaceId,
          'job.enqueued',
          `Job ${jobType} queued`,
          job.id,
          auth.principal.id
        );
      }

      sendJson(res, created ? 201 : 200, { job, created });
      return;
    }

    // List: GET /api/jobs?workspaceId=...
    if (pathname === '/api/jobs' && req.method === 'GET') {
      const auth = await authenticateRequest(req);
      if (!auth) {
        sendJson(res, 401, { error: 'UNAUTHENTICATED' });
        return;
      }
      if (!requireScope(auth, 'read')) {
        scopeDenied(res, 'read');
        return;
      }

      const workspaceId = url.searchParams.get('workspaceId');
      if (!workspaceId) {
        sendJson(res, 400, { error: 'workspaceId is required' });
        return;
      }

      const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
      if (!mem) {
        sendJson(res, 403, { error: 'FORBIDDEN: Not a member of this workspace' });
        return;
      }

      sendJson(res, 200, await dbListJobs(workspaceId));
      return;
    }

    // Activity feed: GET /api/activity?workspaceId=...
    if (pathname === '/api/activity' && req.method === 'GET') {
      const auth = await authenticateRequest(req);
      if (!auth) {
        sendJson(res, 401, { error: 'UNAUTHENTICATED' });
        return;
      }

      const workspaceId = url.searchParams.get('workspaceId');
      if (!workspaceId) {
        sendJson(res, 400, { error: 'workspaceId is required' });
        return;
      }

      const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
      if (!mem) {
        sendJson(res, 403, { error: 'FORBIDDEN: Not a member of this workspace' });
        return;
      }

      sendJson(res, 200, await dbListActivity(workspaceId));
      return;
    }

    // Manual retry: POST /api/jobs/:id/retry?workspaceId=...
    // Recovery path for a job stuck after retry exhaustion.
    if (pathname.startsWith('/api/jobs/') && pathname.endsWith('/retry') && req.method === 'POST') {
      const auth = await authenticateRequest(req);
      if (!auth) {
        sendJson(res, 401, { error: 'UNAUTHENTICATED' });
        return;
      }

      const jobId = pathname.slice('/api/jobs/'.length, -'/retry'.length);
      const workspaceId = url.searchParams.get('workspaceId');
      if (!jobId || !workspaceId) {
        sendJson(res, 400, { error: 'jobId and workspaceId are required' });
        return;
      }

      const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
      if (!mem || (mem.role !== 'owner' && mem.role !== 'admin')) {
        sendJson(res, 403, { error: 'FORBIDDEN: Owner or admin role required to retry jobs' });
        return;
      }

      const rows = await query<{ id: string }>(
        `UPDATE octo.jobs
         SET state = 'queued', attempt = 0, available_at = now(),
             error_code = NULL, error_summary = NULL, completed_at = NULL, updated_at = now()
         WHERE id = $1 AND workspace_id = $2 AND state = 'failed'
         RETURNING id`,
        [jobId, workspaceId]
      );

      if (rows.length === 0) {
        sendJson(res, 404, { error: 'JOB_NOT_RETRYABLE: no failed job with that id in this workspace' });
        return;
      }

      await dbRecordActivity(workspaceId, 'job.requeued', 'Job manually requeued', jobId, auth.principal.id);
      sendJson(res, 200, { success: true, jobId });
      return;
    }

    // Worker tick: POST /api/jobs/run?workspaceId=...
    // Runs one drain pass so the operations page can demonstrate real progress
    // without requiring a separately supervised worker process.
    if (pathname === '/api/jobs/run' && req.method === 'POST') {
      const auth = await authenticateRequest(req);
      if (!auth) {
        sendJson(res, 401, { error: 'UNAUTHENTICATED' });
        return;
      }

      const workspaceId = url.searchParams.get('workspaceId');
      if (!workspaceId) {
        sendJson(res, 400, { error: 'workspaceId is required' });
        return;
      }

      const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
      if (!mem || (mem.role !== 'owner' && mem.role !== 'admin' && mem.role !== 'operator')) {
        sendJson(res, 403, { error: 'FORBIDDEN: Operator role or higher required to run jobs' });
        return;
      }

      const outcomes = await drainQueueOnce();
      sendJson(res, 200, { outcomes });
      return;
    }

    // 11. Retrieval: ingest and query (Slice 8)
    // Ingest: POST /api/rag/documents
    if (pathname === '/api/rag/documents' && req.method === 'POST') {
      const auth = await authenticateRequest(req);
      if (!auth) {
        sendJson(res, 401, { error: 'UNAUTHENTICATED' });
        return;
      }
      if (!requireScope(auth, 'write')) {
        scopeDenied(res, 'write');
        return;
      }

      const embeddingConfig = loadEmbeddingConfigFromEnv();
      if (!embeddingConfig) {
        sendJson(res, 503, {
          error: 'EMBEDDING_PROVIDER_NOT_CONFIGURED: set INFERHUB_API_KEY to ingest documents',
        });
        return;
      }

      const bodyStr = await readBody(req);
      const parsed = JSON.parse(bodyStr);
      const { workspaceId, title, text, mimeType } = parsed;

      if (!workspaceId || !title || typeof text !== 'string') {
        sendJson(res, 400, { error: 'workspaceId, title, and text are required' });
        return;
      }

      const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
      if (!mem || (mem.role !== 'owner' && mem.role !== 'admin' && mem.role !== 'operator')) {
        sendJson(res, 403, { error: 'FORBIDDEN: Operator role or higher required to ingest documents' });
        return;
      }

      const bytes = Buffer.from(text, 'utf-8');
      const resolvedMime = mimeType ?? 'text/plain';
      const extracted = extractText(resolvedMime, bytes);
      if (extracted === null) {
        sendJson(res, 415, {
          error: `EXTRACTION_UNSUPPORTED: cannot faithfully extract text from ${resolvedMime}`,
        });
        return;
      }

      const hash = contentHash(bytes);
      const configId = await dbEnsureEmbeddingConfig(
        workspaceId,
        embeddingConfig.model,
        'v1',
        embeddingConfig.dimensions,
        'paragraph-aware',
        800,
        100
      );

      const version = await dbUpsertDocumentVersion(
        workspaceId,
        title,
        hash,
        resolvedMime,
        bytes.byteLength,
        extracted,
        auth.principal.id
      );

      // Re-ingesting identical bytes is a no-op beyond the version lookup.
      if (!version.created) {
        sendJson(res, 200, {
          documentId: version.documentId,
          versionId: version.versionId,
          created: false,
          message: 'Identical content already ingested; no new version created.',
        });
        return;
      }

      const chunks = chunkText(extracted, {
        model: embeddingConfig.model,
        modelVersion: 'v1',
        dimensions: embeddingConfig.dimensions,
        chunker: 'paragraph-aware',
        chunkSize: 800,
        chunkOverlap: 100,
      }).map((c) => ({
        ...c,
        chunkKey: chunkKey(version.versionId, configId, c.chunkIndex),
      }));

      const { vectors } = await embedTexts(embeddingConfig, chunks.map((c) => c.content));
      const written = await dbReplaceChunksAndEmbeddings(
        workspaceId,
        version.versionId,
        configId,
        chunks,
        vectors
      );

      sendJson(res, 201, {
        documentId: version.documentId,
        versionId: version.versionId,
        contentHash: hash,
        chunks: written,
        embedding: { model: embeddingConfig.model, dimensions: embeddingConfig.dimensions },
        created: true,
      });
      return;
    }

    // Query: POST /api/rag/query
    if (pathname === '/api/rag/query' && req.method === 'POST') {
      const auth = await authenticateRequest(req);
      if (!auth) {
        sendJson(res, 401, { error: 'UNAUTHENTICATED' });
        return;
      }
      if (!requireScope(auth, 'read')) {
        scopeDenied(res, 'read');
        return;
      }

      const embeddingConfig = loadEmbeddingConfigFromEnv();
      if (!embeddingConfig) {
        sendJson(res, 503, {
          error: 'EMBEDDING_PROVIDER_NOT_CONFIGURED: set INFERHUB_API_KEY to query documents',
        });
        return;
      }

      const bodyStr = await readBody(req);
      const parsed = JSON.parse(bodyStr);
      const { workspaceId, query, limit } = parsed;

      if (!workspaceId || !query) {
        sendJson(res, 400, { error: 'workspaceId and query are required' });
        return;
      }

      const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
      if (!mem) {
        sendJson(res, 403, { error: 'FORBIDDEN: Not a member of this workspace' });
        return;
      }

      const { vectors } = await embedTexts(embeddingConfig, [query]);
      const results = await dbMatchChunks(workspaceId, vectors[0]!, limit ?? 10, 0);

      sendJson(res, 200, {
        query,
        matches: results,
        // Provenance: each match carries the version and the exact embedding/chunker
        // configuration that produced it.
      });
      return;
    }

    // 404 for unknown route
    sendJson(res, 404, { error: `Not found: ${req.method} ${pathname}` });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { error: `INTERNAL_SERVER_ERROR: ${message}` });
  }
});

// Start listening if run directly
if (process.argv[1]?.endsWith('server/index.ts') || process.argv[1]?.endsWith('server/index.js')) {
  server.listen(PORT, () => {
    console.log(`Octo Platform Server listening on http://localhost:${PORT}`);
    console.log(`- Health: http://localhost:${PORT}/health`);
    console.log(`- Guest Login: POST http://localhost:${PORT}/api/auth/guest`);
    console.log(`- R2 Active Bucket: ${r2Provider ? r2Provider.bucket : 'none'}`);
  });
}
