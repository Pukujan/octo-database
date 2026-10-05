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
import { createHash, randomBytes, randomUUID } from 'crypto';
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
import {
  AUTH_GUIDANCE,
  capabilitiesForScopes,
  hasScope,
  minimumRoleForCapability,
  OctoScope,
} from '../api/capabilities';
import { chunkKey, chunkText, contentHash, extractText } from '../rag/pipeline';
import { embedTexts, loadEmbeddingConfigFromEnv } from '../rag/embeddings';
import { hashApiKeySecret, authorizeKeyMint } from '../api/keys';
import { sendStaticFile } from './static-file';
import { guestSlug, personalSlug } from '../lib/provisioning-slug';
import {
  dbCountTransientFiles,
  dbCountCreatedWorkspacesSince,
  dbCreateWorkspaceAtomic,
  dbDeleteFileIfIdle,
  dbEnqueueFileTransition,
  dbDeleteWorkspaceAtomic,
  dbGetArchiveRecord,
  dbGetAccountWideKeyId,
  dbGetAuthorizedWorkspaces,
  dbGetConfirmSecretHash,
  dbGetFile,
  dbGetWorkspaceById,
  dbGetWorkspaceMembership,
  dbHasOpenFileJob,
  dbInsertApiKey,
  dbInsertFile,
  dbInsertGuestPrincipal,
  dbUpsertGooglePrincipal,
  dbInsertMembership,
  dbInsertWorkspace,
  dbListAgedActiveFiles,
  dbListApiKeys,
  dbListRetentionWorkspaces,
  dbListWorkspaceStorageKeys,
  dbClaimJob,
  dbCompleteJob,
  dbEnsureEmbeddingConfig,
  dbMatchChunks,
  dbReplaceChunksAndEmbeddings,
  dbUpsertDocumentVersion,
  dbEnqueueJob,
  dbRetryJob,
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
  dbSetConfirmSecret,
  dbUpdateArchiveState,
  dbVerifyApiKey,
  query,
  queryService,
  bindRequestIdentity,
  runWithRequestIdentity,
  testDbConnection,
} from './db';
import { Principal, ROLE_HIERARCHY, WorkspaceRole } from '../types/auth';

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

// Helper: read a JSON object body, tolerating empty or malformed input. An
// absent body becomes {}, so each route's own validation produces its intended
// refusal (400/403/412) rather than an unhandled 500 from JSON.parse.
async function readJsonObject(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// Refuse an identifier that is not a UUID before it reaches a Postgres uuid
// column, where a malformed value raises 22P02 and the outer handler would answer
// 500 with raw database text. Writes a clean 400 and returns false when the value
// is malformed, so the caller returns immediately.
function requireUuid(res: ServerResponse, value: string, field: string): boolean {
  if (UUID_PATTERN.test(value)) return true;
  const code = field === 'workspaceId' ? 'INVALID_WORKSPACE_ID' : 'INVALID_IDENTIFIER';
  sendJson(res, 400, { error: code, code, message: `${field} must be a UUID.` });
  return false;
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

function keyWorkspaceMatches(auth: AuthContext, workspaceId: string): boolean {
  return !auth.apiKey?.workspaceId || auth.apiKey.workspaceId === workspaceId;
}

function effectiveWorkspaceRole(auth: AuthContext, liveRoleValue: string): WorkspaceRole {
  const liveRole = liveRoleValue in ROLE_HIERARCHY ? liveRoleValue as WorkspaceRole : 'member';
  const keyRole = auth.apiKey?.workspaceId ? auth.apiKey.role as WorkspaceRole | null : null;
  if (!keyRole || !(keyRole in ROLE_HIERARCHY)) return liveRole;
  return ROLE_HIERARCHY[liveRole] <= ROLE_HIERARCHY[keyRole] ? liveRole : keyRole;
}

function roleMeetsMinimum(role: WorkspaceRole, minimum: WorkspaceRole): boolean {
  return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[minimum];
}

function roleAllows(auth: AuthContext, liveRole: string, minimum: WorkspaceRole): boolean {
  return roleMeetsMinimum(effectiveWorkspaceRole(auth, liveRole), minimum);
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
    const rows = await queryService<{
      id: string;
      auth_user_id: string;
      email: string;
      display_name: string | null;
      avatar_url: string | null;
      is_guest: boolean;
      is_platform_owner: boolean;
    }>(
      'SELECT id, auth_user_id, email, display_name, avatar_url, is_guest, is_platform_owner FROM octo.principals WHERE id = $1',
      [verified.principalId]
    );

    if (rows.length === 0) return null;
    const pRow = rows[0]!;

    const principal: Principal = {
      id: pRow.id,
      authUserId: pRow.auth_user_id,
      email: pRow.email,
      displayName: pRow.display_name,
      avatarUrl: pRow.avatar_url ?? null,
      isPlatformOwner: pRow.is_platform_owner,
      isGuest: pRow.is_guest,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    bindRequestIdentity(pRow.id, verified.workspaceId ?? null);

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

  const rows = await queryService<{
    id: string;
    auth_user_id: string;
    email: string;
    display_name: string | null;
    avatar_url: string | null;
    is_guest: boolean;
    is_platform_owner: boolean;
  }>(
    'SELECT id, auth_user_id, email, display_name, avatar_url, is_guest, is_platform_owner FROM octo.principals WHERE id = $1',
    [token]
  );

  if (rows.length === 0) return null;
  const pRow = rows[0]!;

  bindRequestIdentity(pRow.id, null);

  return {
    principal: {
      id: pRow.id,
      authUserId: pRow.auth_user_id,
      email: pRow.email,
      displayName: pRow.display_name,
      avatarUrl: pRow.avatar_url ?? null,
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
): Promise<MediaAuthorization | false | null> {
  const bearer = await authenticateRequest(req);
  if (bearer) {
    const workspaceId = url.searchParams.get('workspaceId');
    const fileId = url.searchParams.get('fileId');
    if (!workspaceId || !fileId) return null;
    // A malformed id can never resolve to a membership, and passing it to a uuid
    // column would raise 22P02; refuse before the lookup.
    if (!UUID_PATTERN.test(workspaceId) || !UUID_PATTERN.test(fileId)) return null;
    if (!requireScope(bearer, 'files') || !keyWorkspaceMatches(bearer, workspaceId)) return false;
    const mem = await dbGetWorkspaceMembership(workspaceId, bearer.principal.id);
    if (!mem || !roleAllows(bearer, mem.role, 'member')) return false;
    return { principalId: bearer.principal.id, workspaceId, fileId };
  }

  const claims = verifyMediaToken(url.searchParams);
  if (!claims) return null;

  if (claims.kind === 'principal') {
    // Membership is still re-checked, so revoking access invalidates live tokens.
    const mem = await dbGetWorkspaceMembership(claims.workspaceId, claims.principalId);
    if (!mem) return null;
    // The signature already names the principal and workspace, so bind them before the
    // fenced file read that follows (image/video tags carry no Authorization header).
    bindRequestIdentity(claims.principalId, claims.workspaceId);
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

  // Bind the share creator so the fenced read is scoped to exactly the shared
  // workspace; the creator is a member, so the membership predicate also passes.
  bindRequestIdentity(share.createdBy, claims.workspaceId);

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
async function drainQueueOnce(targetWorkspaceId?: string, maxJobs = 10): Promise<JobOutcome[]> {
  const outcomes: JobOutcome[] = [];

  for (let i = 0; i < maxJobs; i += 1) {
    const job = await dbClaimJob('octo-server-worker', 60, targetWorkspaceId ?? null);
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

    // Only return outcomes belonging to the caller's workspace to prevent cross-workspace data leakage
    if (!targetWorkspaceId || job.workspaceId === targetWorkspaceId) {
      outcomes.push(outcome);
    }
  }

  return outcomes;
}

/**
 * Enqueues an archive (or restore) job for one file. The idempotency key is
 * scoped to the transition *cycle*, not just the file: it embeds a monotonic
 * count of prior jobs of this type for this file. While a transition is in flight
 * the count is unchanged, so a repeat is deduped; once it completes the count
 * increments, so a later archive -> restore -> archive is not permanently
 * swallowed by the jobs unique constraint (the re-archive defect).
 */
async function enqueueFileTransition(
  direction: 'archive' | 'restore',
  workspaceId: string,
  file: { id: string; storageKey: string; mimeType: string },
  createdBy: string | null
): Promise<
  | { status: 'missing' }
  | { status: 'busy' }
  | { status: 'queued'; job: Awaited<ReturnType<typeof dbEnqueueJob>>['job']; created: boolean }
> {
  return dbEnqueueFileTransition(
    randomUUID(),
    workspaceId,
    direction,
    `${direction}:${file.id}`,
    { fileId: file.id, storageKey: file.storageKey, mimeType: file.mimeType },
    createdBy
  );
}

/**
 * The retention/tiering policy in full: `workspaces.retention_days` is the only
 * knob. For each workspace with a window set, active files older than the window
 * are enqueued for archival. NULL means never auto-archive. Files already
 * mid-transition are skipped so a slow archive is not double-queued.
 */
async function runRetentionSweep(): Promise<number> {
  if (!archiveDeps) return 0;

  let enqueued = 0;
  for (const workspace of await dbListRetentionWorkspaces()) {
    for (const fileId of await dbListAgedActiveFiles(workspace.id, workspace.retentionDays)) {
      if (await dbHasOpenFileJob(workspace.id, 'archive_file', fileId)) continue;

      // The sweep runs with no caller identity (a background interval), so it reads
      // through the trusted service pool: dbGetFile is RLS-fenced and would return
      // nothing without a bound principal.
      const file = await dbGetArchiveRecord(workspace.id, fileId);
      if (!file) continue;

      const transition = await enqueueFileTransition(
        'archive',
        workspace.id,
        { id: file.fileId, storageKey: file.storageKey, mimeType: file.mimeType },
        null
      );
      if (transition.status === 'queued' && transition.created) enqueued += 1;
    }
  }
  return enqueued;
}

/**
 * Starts the two background loops a single container needs: a minute tick that
 * drains the job queue (so queued archiving/restores progress without a human
 * pressing "Run worker pass"), and an hourly retention sweep. Both are unref'd so
 * they never hold the process open.
 */
function startSchedulers(): void {
  setInterval(() => {
    drainQueueOnce(undefined, 25).catch((err) => console.warn('Queue drain tick failed:', err));
  }, 60_000).unref();

  setInterval(() => {
    runRetentionSweep()
      .then(async (enqueued) => {
        if (enqueued > 0) {
          console.log(`Retention sweep enqueued ${enqueued} archive job(s)`);
          await drainQueueOnce(undefined, 25);
        }
      })
      .catch((err) => console.warn('Retention sweep failed:', err));
  }, 60 * 60 * 1000).unref();
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

/** Lowercase, hyphenated, URL-safe form of a workspace name. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/**
 * The human confirmation gate for destructive commands. It is satisfied only when
 * both hold: the caller is a human session (no API key), and the supplied secret
 * hashes to the principal's stored confirmation secret. An API-key caller can
 * never satisfy it, whatever its scopes -- that is the structural answer to "can
 * a blind agent delete a workspace".
 *
 * Fails closed: an account that never set a secret refuses with
 * CONFIRM_SECRET_NOT_SET rather than falling open. Returns true when the request
 * may proceed, having already written the refusal response otherwise.
 */
async function confirmGate(
  res: ServerResponse,
  auth: AuthContext,
  suppliedSecret: unknown
): Promise<boolean> {
  if (auth.apiKey) {
    sendJson(res, 403, {
      error: 'FORBIDDEN: Destructive commands require a human session; API keys can never confirm.',
    });
    return false;
  }

  const stored = await dbGetConfirmSecretHash(auth.principal.id);
  if (!stored) {
    sendJson(res, 412, {
      error: 'CONFIRM_SECRET_NOT_SET: Set a confirmation secret via POST /api/me/confirm-secret first.',
    });
    return false;
  }

  if (typeof suppliedSecret !== 'string' || hashApiKeySecret(suppliedSecret) !== stored) {
    sendJson(res, 403, { error: 'CONFIRM_SECRET_INVALID: Confirmation secret does not match.' });
    return false;
  }

  return true;
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

/**
 * Resolves the public origin from PUBLIC_BASE_URL, X-Forwarded-* headers,
 * Host header, or fallback local URL origin.
 */
export function getPublicOrigin(req: IncomingMessage, url: URL): string {
  const publicBase = process.env['PUBLIC_BASE_URL'];
  if (publicBase) {
    return publicBase.replace(/\/+$/, '');
  }
  const hostHeader = req.headers['x-forwarded-host'] ?? req.headers.host;
  if (hostHeader) {
    const host = (Array.isArray(hostHeader) ? hostHeader[0] : hostHeader).split(',')[0]!.trim();
    const protoHeader = req.headers['x-forwarded-proto'];
    const proto = protoHeader
      ? (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader).split(',')[0]!.trim()
      : 'http';
    return `${proto}://${host}`;
  }
  return url.origin;
}

export function getGoogleClientCredentials(): { clientId: string | null; clientSecret: string | null } {
  const clientId = process.env['GOOGLE_OAUTH_CLIENT_ID'] ?? process.env['GOOGLE_CLIENT_ID'] ?? null;
  const clientSecret = process.env['GOOGLE_OAUTH_CLIENT_SECRET'] ?? process.env['GOOGLE_CLIENT_SECRET'] ?? null;
  return { clientId, clientSecret };
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
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

  // A malformed request target (for example the absolute-form `http://[`) makes
  // URL() throw ERR_INVALID_URL. Constructing it before the try below would turn
  // that into an unhandled rejection that terminates the single-process host, so
  // answer the bad request instead of dying on it.
  let url: URL;
  try {
    url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  } catch {
    sendJson(res, 400, { error: 'BAD_REQUEST: malformed request target' });
    return;
  }
  const pathname = url.pathname;

  try {
    // 1. Health check (tests both PostgreSQL and Cloudflare R2 connections)
    if (pathname === '/health' && req.method === 'GET') {
      const dbStatus = await testDbConnection();
      const r2Status = r2Provider ? await r2Provider.testConnection() : { connected: false, bucket: 'none' };
      const { clientId } = getGoogleClientCredentials();
      sendJson(res, 200, {
        status: 'ok',
        version: '0.1.0',
        database: dbStatus,
        r2: r2Status,
        googleAuthEnabled: Boolean(clientId),
      });
      return;
    }

    // 1b. Google OAuth start. Reports a clear state instead of a dead 404 when the
    // OAuth client has not been provisioned yet.
    if (pathname === '/api/auth/google' && req.method === 'GET') {
      const { clientId } = getGoogleClientCredentials();
      if (!clientId) {
        sendJson(res, 501, {
          error:
            'GOOGLE_AUTH_NOT_CONFIGURED: Set GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET, or use Guest access.',
        });
        return;
      }
      const origin = getPublicOrigin(req, url);
      const redirectUri = `${origin}/api/auth/google/callback`;
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

    // 1c. Google OAuth callback: GET /api/auth/google/callback
    if (pathname === '/api/auth/google/callback' && req.method === 'GET') {
      const origin = getPublicOrigin(req, url);
      const errorParam = url.searchParams.get('error');
      if (errorParam) {
        res.writeHead(302, { Location: `${origin}/#auth_error=${encodeURIComponent(errorParam)}` });
        res.end();
        return;
      }
      const code = url.searchParams.get('code');
      if (!code) {
        res.writeHead(302, { Location: `${origin}/#auth_error=MISSING_CODE` });
        res.end();
        return;
      }
      const { clientId, clientSecret } = getGoogleClientCredentials();
      if (!clientId || !clientSecret) {
        res.writeHead(302, { Location: `${origin}/#auth_error=GOOGLE_AUTH_NOT_CONFIGURED` });
        res.end();
        return;
      }
      const redirectUri = `${origin}/api/auth/google/callback`;
      try {
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          }),
        });

        if (!tokenResponse.ok) {
          const errText = await tokenResponse.text();
          console.error('Google token exchange failed:', tokenResponse.status, errText);
          res.writeHead(302, { Location: `${origin}/#auth_error=TOKEN_EXCHANGE_FAILED` });
          res.end();
          return;
        }

        const tokenData = (await tokenResponse.json()) as { id_token?: string; access_token?: string };
        let sub = '';
        let email = '';
        let displayName: string | null = null;
        let avatarUrl: string | null = null;

        if (tokenData.id_token) {
          try {
            const parts = tokenData.id_token.split('.');
            if (parts.length >= 2) {
              const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
              sub = payload.sub ?? '';
              email = payload.email ?? '';
              displayName = payload.name ?? null;
              avatarUrl = payload.picture ?? null;
            }
          } catch (e) {
            console.warn('Could not parse Google id_token payload:', e);
          }
        }

        if ((!sub || !email) && tokenData.access_token) {
          const userinfoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
          });
          if (userinfoRes.ok) {
            const userinfo = (await userinfoRes.json()) as {
              sub?: string;
              email?: string;
              name?: string;
              picture?: string;
            };
            sub = userinfo.sub ?? sub;
            email = userinfo.email ?? email;
            displayName = userinfo.name ?? displayName;
            avatarUrl = userinfo.picture ?? avatarUrl;
          }
        }

        if (!sub || !email) {
          res.writeHead(302, { Location: `${origin}/#auth_error=MISSING_PROFILE` });
          res.end();
          return;
        }

        // Derive deterministic RFC4122-compatible UUID for sub to satisfy PostgreSQL UUID type
        const subHash = createHash('sha256').update(`google:${sub}`).digest('hex');
        const authUserId = `${subHash.slice(0, 8)}-${subHash.slice(8, 12)}-4${subHash.slice(13, 16)}-a${subHash.slice(17, 20)}-${subHash.slice(20, 32)}`;

        const principal = await dbUpsertGooglePrincipal(authUserId, email, displayName, avatarUrl);

        // Ensure the principal has at least one workspace to enter
        const workspaces = await dbGetAuthorizedWorkspaces(principal.id);
        if (workspaces.length === 0) {
          const slug = personalSlug(principal.id);
          const ws = await dbInsertWorkspace(
            randomUUID(),
            slug,
            'Personal',
            'Personal workspace',
            principal.id
          );
          await dbInsertMembership(ws.id, principal.id, 'owner');
        }

        res.writeHead(302, { Location: `${origin}/#token=${principal.id}` });
        res.end();
        return;
      } catch (err) {
        console.error('Google auth callback error:', err);
        res.writeHead(302, { Location: `${origin}/#auth_error=INTERNAL_ERROR` });
        res.end();
        return;
      }
    }

    // 2. Guest Login: POST /api/auth/guest
    if (pathname === '/api/auth/guest' && req.method === 'POST') {
      // Tolerate a malformed, empty, or non-object body: this endpoint is
      // anonymous and bodyless-friendly, so an absent displayName defaults rather
      // than throwing a bare JSON.parse error as a 500.
      const parsed = await readJsonObject(req);
      const displayName = typeof parsed.displayName === 'string' ? parsed.displayName : 'Guest User';

      const guestId = randomUUID();
      const slug = guestSlug(guestId);
      const email = `${slug}@octo.local`;

      // Insert guest principal in PostgreSQL
      const principal = await dbInsertGuestPrincipal(guestId, guestId, email, displayName);

      // Auto-provision Personal (Guest) workspace in PostgreSQL
      const workspaceId = randomUUID();
      const workspace = await dbInsertWorkspace(
        workspaceId,
        slug,
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

    // 2b. Current Principal: GET /api/me
    if (pathname === '/api/me' && req.method === 'GET') {
      const auth = await authenticateRequest(req);
      if (!auth) {
        sendJson(res, 401, { error: 'UNAUTHENTICATED' });
        return;
      }
      // The client needs to know whether the destructive-command gate is armed so
      // it can prompt for setup rather than letting the user hit a 412.
      const confirmSecretSet = Boolean(await dbGetConfirmSecretHash(auth.principal.id));
      sendJson(res, 200, {
        principal: auth.principal,
        apiKey: auth.apiKey ?? null,
        confirmSecretSet,
      });
      return;
    }

    // 2c. Set or rotate the confirmation secret: POST /api/me/confirm-secret
    // Human session only. Rotation is itself destructive, so changing an existing
    // secret requires presenting the current one; first-time setup does not.
    if (pathname === '/api/me/confirm-secret' && req.method === 'POST') {
      const auth = await authenticateRequest(req);
      if (!auth) {
        sendJson(res, 401, { error: 'UNAUTHENTICATED' });
        return;
      }
      if (auth.apiKey) {
        sendJson(res, 403, {
          error: 'FORBIDDEN: The confirmation secret is set from a human session, never an API key.',
        });
        return;
      }

      const parsed = await readJsonObject(req);
      const { secret, currentSecret } = parsed;
      if (typeof secret !== 'string' || secret.length < 8) {
        sendJson(res, 400, { error: 'BAD_REQUEST: secret must be a string of at least 8 characters' });
        return;
      }

      const existing = await dbGetConfirmSecretHash(auth.principal.id);
      if (existing) {
        if (typeof currentSecret !== 'string' || hashApiKeySecret(currentSecret) !== existing) {
          sendJson(res, 403, {
            error: 'CONFIRM_SECRET_INVALID: the current confirmation secret is required to rotate it.',
          });
          return;
        }
      }

      await dbSetConfirmSecret(auth.principal.id, hashApiKeySecret(secret));
      sendJson(res, 200, { success: true, rotated: Boolean(existing) });
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
          retention_days: number | null;
        }>('SELECT id, slug, name, description, retention_days FROM octo.workspaces WHERE id = $1', [
          auth.apiKey.workspaceId,
        ]);

        const mem = await dbGetWorkspaceMembership(auth.apiKey.workspaceId, auth.principal.id);
        if (rows.length === 0 || !mem) {
          sendJson(res, 403, { error: 'FORBIDDEN: Not a member of this workspace' });
          return;
        }

        const ws = rows[0]!;
        sendJson(res, 200, [
          {
            id: ws.id,
            slug: ws.slug,
            name: ws.name,
            description: ws.description,
            role: effectiveWorkspaceRole(auth, mem.role),
            isOwner: effectiveWorkspaceRole(auth, mem.role) === 'owner',
            retentionDays: ws.retention_days,
          },
        ]);
        return;
      }

      // Account-wide API key or user session: query all authorized workspaces from PostgreSQL
      const workspaces = await dbGetAuthorizedWorkspaces(auth.principal.id);
      sendJson(res, 200, workspaces);
      return;
    }

    // 3b. Create a workspace: POST /api/workspaces
    // Workspace = database: the creator becomes owner and the workspace's single
    // API key is minted in the same transaction, so a workspace can never exist
    // without its key. The raw key secret is returned exactly once, here.
    if (pathname === '/api/workspaces' && req.method === 'POST') {
      const auth = await authenticateRequest(req);
      if (!auth) {
        sendJson(res, 401, { error: 'UNAUTHENTICATED' });
        return;
      }
      if (!requireScope(auth, 'write')) {
        scopeDenied(res, 'write');
        return;
      }
      // A workspace-scoped key is pinned to one workspace and cannot mint more.
      if (auth.apiKey && auth.apiKey.workspaceId) {
        sendJson(res, 403, {
          error: 'FORBIDDEN: A workspace-scoped key cannot create workspaces',
        });
        return;
      }

      const parsed = await readJsonObject(req);
      const { name, slug, description, retentionDays } = parsed;

      if (!name || typeof name !== 'string' || !slugify(name)) {
        sendJson(res, 400, { error: 'BAD_REQUEST: a name that slugifies to at least one character is required' });
        return;
      }
      let retentionDaysValue: number | null = null;
      if (retentionDays !== undefined && retentionDays !== null) {
        if (typeof retentionDays !== 'number' || !Number.isInteger(retentionDays) || retentionDays <= 0) {
          sendJson(res, 400, { error: 'BAD_REQUEST: retentionDays must be a positive integer' });
          return;
        }
        retentionDaysValue = retentionDays;
      }

      const resolvedSlug = typeof slug === 'string' && slug.trim() ? slugify(slug) : slugify(name);
      if (!resolvedSlug) {
        sendJson(res, 400, { error: 'BAD_REQUEST: slug is empty' });
        return;
      }

      // Creating a workspace mints a tenancy boundary and its first key. Like
      // deletion, it is stamped by a human session plus the confirmation secret,
      // so an agent holding the account-wide key cannot create workspaces at all.
      if (!(await confirmGate(res, auth, parsed.confirmSecret))) return;

      // Slice 16: a second, independent guard. Even a compromised browser session
      // that holds the confirmation secret may create at most one workspace per
      // rolling day. The platform owner is exempt. The auto-provisioned personal
      // sandbox does not count (see dbCountCreatedWorkspacesSince).
      if (!auth.principal.isPlatformOwner) {
        const createdLastDay = await dbCountCreatedWorkspacesSince(
          auth.principal.id,
          new Date(Date.now() - 24 * 60 * 60 * 1000)
        );
        if (createdLastDay >= 1) {
          sendJson(res, 429, {
            error: 'WORKSPACE_DAILY_LIMIT: You can create one workspace per day. Try again after 24 hours.',
          });
          return;
        }
      }

      const workspaceId = randomUUID();
      const keyId = randomUUID();
      const rawSecret = `octo_live_ws_${randomUUID().replace(/-/g, '')}`;

      try {
        const workspace = await dbCreateWorkspaceAtomic({
          workspaceId,
          slug: resolvedSlug,
          name: name.trim(),
          description: typeof description === 'string' && description.trim() ? description.trim() : null,
          retentionDays: retentionDaysValue,
          createdBy: auth.principal.id,
          keyId,
          keyHash: hashApiKeySecret(rawSecret),
          keyPrefix: 'octo_live_ws',
          keyName: `${name.trim()} workspace key`,
          keyScopes: ['read', 'write', 'files'],
        });

        await dbRecordActivity(
          workspaceId,
          'workspace.created',
          `Workspace '${workspace.name}' created`,
          null,
          auth.principal.id
        );

        sendJson(res, 201, {
          workspace: { ...workspace, role: 'owner', isOwner: true },
          apiKey: {
            id: keyId,
            prefix: 'octo_live_ws',
            name: `${name.trim()} workspace key`,
            workspaceId,
            isAccountWide: false,
            scopes: ['read', 'write', 'files'],
          },
          rawSecret,
        });
      } catch (err) {
        // A slug collision raises the unique-violation code from the plain INSERT.
        if ((err as { code?: string }).code === '23505') {
          sendJson(res, 409, {
            error: `SLUG_TAKEN: a workspace with slug '${resolvedSlug}' already exists`,
          });
          return;
        }
        throw err;
      }
      return;
    }

    // 3c. Delete a workspace: DELETE /api/workspaces/:id
    // Destructive: owner-only, gated on the human confirmation secret plus the
    // typed slug, and refused while any file is mid-archive so a copy in flight
    // cannot be orphaned.
    if (pathname.startsWith('/api/workspaces/') && req.method === 'DELETE') {
      const auth = await authenticateRequest(req);
      if (!auth) {
        sendJson(res, 401, { error: 'UNAUTHENTICATED' });
        return;
      }

      const workspaceId = pathname.slice('/api/workspaces/'.length);
      if (!UUID_PATTERN.test(workspaceId)) {
        sendJson(res, 400, { error: 'BAD_REQUEST: workspaceId must be a valid UUID' });
        return;
      }

      const parsed = await readJsonObject(req);
      if (!(await confirmGate(res, auth, parsed.confirmSecret))) return;

      const workspace = await dbGetWorkspaceById(workspaceId);
      if (!workspace) {
        sendJson(res, 404, { error: 'WORKSPACE_NOT_FOUND' });
        return;
      }

      const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
      // A platform owner may delete any workspace; the gate above already required
      // a human session, so this override is never reachable by an API key.
      if (mem?.role !== 'owner' && !auth.principal.isPlatformOwner) {
        sendJson(res, 403, { error: 'FORBIDDEN: Owner role required to delete a workspace' });
        return;
      }

      if (parsed.confirmSlug !== workspace.slug) {
        sendJson(res, 403, {
          error: `CONFIRM_SLUG_MISMATCH: type the workspace slug '${workspace.slug}' to confirm`,
        });
        return;
      }

      // Refuse while a copy is in flight: deleting now would orphan the bytes.
      if ((await dbCountTransientFiles(workspaceId)) > 0) {
        sendJson(res, 409, {
          error: 'WORKSPACE_BUSY: a file is mid-archive; wait for it to settle and retry',
        });
        return;
      }

      const storageKeys = await dbListWorkspaceStorageKeys(workspaceId);

      // The transaction re-checks the transient state, closing the window between
      // the pre-check above and the delete.
      if (!(await dbDeleteWorkspaceAtomic(workspaceId))) {
        sendJson(res, 409, {
          error: 'WORKSPACE_BUSY: a file entered a transient archive state during delete',
        });
        return;
      }

      sendJson(res, 200, {
        success: true,
        workspaceId,
        slug: workspace.slug,
        // The DB cascade removes rows but not R2/Drive bytes. Report them so the
        // operator sees the consequence instead of a silent leak.
        orphanedObjects: storageKeys,
      });
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
      if (!requireUuid(res, workspaceId, 'workspaceId')) return;

      // Enforce workspace-scoped key restrictions
      if (!keyWorkspaceMatches(auth, workspaceId)) {
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

      const parsed = (await readJsonObject(req)) as Record<string, any>;
      const { workspaceId, name, mimeType, data, dataEncoding } = parsed;

      if (!workspaceId || !name || data === undefined) {
        sendJson(res, 400, { error: 'workspaceId, name, and data are required' });
        return;
      }
      if (!requireUuid(res, workspaceId, 'workspaceId')) return;

      // Enforce workspace-scoped key restriction
      if (auth.apiKey && auth.apiKey.workspaceId && auth.apiKey.workspaceId !== workspaceId) {
        sendJson(res, 403, { error: 'FORBIDDEN: Key restricted to different workspace' });
        return;
      }

      const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
      if (!mem || !roleAllows(auth, mem.role, 'operator')) {
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
      let fileRecord;
      try {
        fileRecord = await dbInsertFile(
          fileId,
          workspaceId,
          auth.principal.id,
          name,
          mimeType ?? 'application/octet-stream',
          sizeBytes,
          storageKey,
          etag?.replace(/"/g, '') ?? null
        );
      } catch (err) {
        try {
          await objectStore.delete(storageKey);
        } catch (cleanupError) {
          console.error(`File upload cleanup failed for ${fileId}:`, cleanupError);
        }
        throw err;
      }

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
      if (!requireScope(auth, 'files')) {
        scopeDenied(res, 'files');
        return;
      }

      const fileId = url.searchParams.get('fileId');
      const workspaceId = url.searchParams.get('workspaceId');
      if (!fileId || !workspaceId) {
        sendJson(res, 400, { error: 'fileId and workspaceId required' });
        return;
      }
      if (!requireUuid(res, fileId, 'fileId')) return;
      if (!requireUuid(res, workspaceId, 'workspaceId')) return;
      if (!keyWorkspaceMatches(auth, workspaceId)) {
        sendJson(res, 403, { error: 'FORBIDDEN: Key restricted to different workspace' });
        return;
      }
      if (!objectStore) {
        sendJson(res, 503, { error: 'STORAGE_UNAVAILABLE: no storage backend configured.' });
        return;
      }

      const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
      if (!mem || !roleAllows(auth, mem.role, 'member')) {
        sendJson(res, 403, { error: 'FORBIDDEN: Not a member of this workspace' });
        return;
      }

      const file = await dbGetFile(workspaceId, fileId);
      if (!file) {
        sendJson(res, 404, { error: 'FILE_NOT_FOUND' });
        return;
      }

      // An archived file has no R2 object to presign, so send the caller to the
      // content endpoint, which restores the bytes on demand.
      const downloadUrl =
        r2Provider && file.archiveState !== 'archived_drive'
          ? await r2Provider.generatePresignedDownloadUrl(file.storageKey, 3600)
          : `/api/files/content?fileId=${fileId}&workspaceId=${workspaceId}`;
      sendJson(res, 200, { file, downloadUrl });
      return;
    }
    // 6b. File Content: GET /api/files/content?workspaceId=...&fileId=...
    // Streams authorized bytes for browser downloads, restoring cold files on demand.
    if (pathname === '/api/files/content' && req.method === 'GET') {
      const auth = await authorizeMediaRequest(req, url);
      if (auth === false) {
        sendJson(res, 403, { error: 'FORBIDDEN: Not authorized for this workspace' });
        return;
      }
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
      if (auth === false) {
        sendJson(res, 403, { error: 'FORBIDDEN: Not authorized for this workspace' });
        return;
      }
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
      if (!requireUuid(res, fileId, 'fileId')) return;
      if (!requireUuid(res, workspaceId, 'workspaceId')) return;
      if (!keyWorkspaceMatches(auth, workspaceId)) {
        sendJson(res, 403, { error: 'FORBIDDEN: Key restricted to different workspace' });
        return;
      }
      if (!objectStore) {
        sendJson(res, 503, { error: 'STORAGE_UNAVAILABLE: no storage backend configured.' });
        return;
      }

      const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
      if (!mem || !roleAllows(auth, mem.role, 'admin')) {
        sendJson(res, 403, { error: 'FORBIDDEN: Owner or admin role required to delete files' });
        return;
      }

      const result = await dbDeleteFileIfIdle(workspaceId, fileId);
      if (result.status === 'missing') {
        sendJson(res, 404, { error: 'FILE_NOT_FOUND' });
        return;
      }
      if (result.status === 'busy') {
        sendJson(res, 409, { error: 'FILE_BUSY: archive or restore is in progress' });
        return;
      }

      await objectStore.delete(result.storageKey);

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
      // Archiving removes the bytes from the active tier, so it needs the delete
      // scope; restoring only writes them back and needs write.
      const requiredScope: OctoScope = direction === 'archive' ? 'delete' : 'write';
      if (!requireScope(auth, requiredScope)) {
        scopeDenied(res, requiredScope);
        return;
      }

      const suffix = `/${direction}`;
      const fileId = pathname.slice('/api/files/'.length, -suffix.length);
      const workspaceId = url.searchParams.get('workspaceId');
      if (!fileId || !workspaceId) {
        sendJson(res, 400, { error: 'fileId and workspaceId required' });
        return;
      }
      if (!requireUuid(res, fileId, 'fileId')) return;
      if (!requireUuid(res, workspaceId, 'workspaceId')) return;

      // A workspace-scoped key may only touch its own workspace.
      if (!keyWorkspaceMatches(auth, workspaceId)) {
        sendJson(res, 403, { error: 'FORBIDDEN: Key restricted to different workspace' });
        return;
      }

      const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
      if (!mem || !roleAllows(auth, mem.role, 'operator')) {
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

      const transition = await enqueueFileTransition(
        direction,
        workspaceId,
        { id: file.id, storageKey: file.storageKey, mimeType: file.mimeType },
        auth.principal.id
      );
      if (transition.status === 'missing') {
        sendJson(res, 404, { error: 'FILE_NOT_FOUND' });
        return;
      }
      if (transition.status === 'busy') {
        sendJson(res, 409, { error: 'FILE_BUSY: another archive or restore is in progress' });
        return;
      }
      const { job, created } = transition;

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
      if (!requireUuid(res, workspaceId, 'workspaceId')) return;
      if (!keyWorkspaceMatches(auth, workspaceId)) {
        sendJson(res, 403, { error: 'FORBIDDEN: Key restricted to different workspace' });
        return;
      }

      const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
      if (!mem || !roleAllows(auth, mem.role, 'member')) {
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
        // An archived file has no R2 object to presign, so it goes through the
        // content route, which restores the bytes on demand.
        const fullUrl =
          r2Provider && f.archiveState !== 'archived_drive'
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

      const parsed = await readJsonObject(req);
      const {
        name,
        workspaceId: requestedWorkspaceId,
        scopes: requestedScopes,
        expiresInDays,
      } = parsed;

      if (!name || typeof name !== 'string') {
        sendJson(res, 400, { error: 'name is required' });
        return;
      }

      let expiresAt: string | null = null;
      if (expiresInDays !== undefined && expiresInDays !== null) {
        if (!Number.isInteger(expiresInDays as number) || (expiresInDays as number) <= 0) {
          sendJson(res, 400, { error: 'BAD_REQUEST: expiresInDays must be a positive integer' });
          return;
        }
        const d = new Date();
        d.setDate(d.getDate() + (expiresInDays as number));
        // A large enough day count overflows the Date range; refuse it rather than
        // letting toISOString() throw `Invalid time value` as a 500.
        if (!Number.isFinite(d.getTime())) {
          sendJson(res, 400, { error: 'BAD_REQUEST: expiresInDays is out of range' });
          return;
        }
        expiresAt = d.toISOString();
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
        const unknown = requestedScopes.filter((s: unknown) => !ALLOWED_SCOPES.includes(s as string));
        if (unknown.length > 0) {
          sendJson(res, 400, { error: `BAD_REQUEST: unknown scopes: ${unknown.join(', ')}` });
          return;
        }
        scopes = requestedScopes as string[];
      }

      if (
        requestedWorkspaceId !== undefined &&
        requestedWorkspaceId !== null &&
        typeof requestedWorkspaceId !== 'string'
      ) {
        sendJson(res, 400, { error: 'BAD_REQUEST: workspaceId must be a UUID string' });
        return;
      }
      let workspaceId: string | null =
        typeof requestedWorkspaceId === 'string' ? requestedWorkspaceId : null;
      if (workspaceId !== null && !UUID_PATTERN.test(workspaceId)) {
        sendJson(res, 400, { error: 'BAD_REQUEST: workspaceId must be a valid UUID' });
        return;
      }

      // A token may only narrow its own authority when minting another key: it
      // cannot widen its scopes, escape its workspace binding, or turn a
      // workspace-bound token into an account-wide one.
      const decision = authorizeKeyMint(
        {
          isApiKey: Boolean(auth.apiKey),
          workspaceId: auth.apiKey?.workspaceId ?? null,
          scopes: auth.apiKey?.scopes ?? [],
        },
        { workspaceId, scopes }
      );
      if (!decision.ok) {
        sendJson(res, decision.status, { error: decision.error });
        return;
      }
      workspaceId = decision.workspaceId;
      scopes = decision.scopes;

      // If workspace-scoped key requested, verify caller belongs to that workspace
      if (workspaceId) {
        const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
        if (!mem) {
          sendJson(res, 403, { error: 'FORBIDDEN: Cannot create API key for non-member workspace' });
          return;
        }
      }

      // `admin` names platform-owner authority, so only a platform owner may hold
      // or grant it. A key caller could otherwise mint itself a wider key.
      if (scopes.includes('admin') && !auth.principal.isPlatformOwner) {
        sendJson(res, 403, { error: 'FORBIDDEN: The admin scope is reserved for platform owners.' });
        return;
      }

      // Minting a credential grants authority, so it carries the same human stamp
      // as workspace creation and deletion: a human session plus the confirmation
      // secret. An API-key caller is refused outright, so a leaked agent token
      // cannot mint itself a wider key.
      if (!(await confirmGate(res, auth, parsed.confirmSecret))) return;

      const isAccountWide = !workspaceId;

      // At most one account-wide key per principal (enforced by a partial unique
      // index). Refuse a duplicate with guidance rather than minting a second one.
      if (isAccountWide && (await dbGetAccountWideKeyId(auth.principal.id))) {
        sendJson(res, 409, {
          error: 'ACCOUNT_KEY_EXISTS: revoke the existing account-wide key before creating another.',
        });
        return;
      }

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
        scopes,
        expiresAt
      );

      sendJson(res, 201, {
        apiKey: {
          id: keyId,
          prefix,
          name,
          workspaceId: workspaceId ?? null,
          isAccountWide,
          scopes,
          expiresAt,
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
      // Revoking a credential is destructive: a read-only or ingest token must
      // not be able to withdraw the account's keys.
      if (!requireScope(auth, 'delete')) {
        scopeDenied(res, 'delete');
        return;
      }

      const keyId = pathname.slice('/api/keys/'.length);
      if (!keyId || !UUID_PATTERN.test(keyId)) {
        sendJson(res, 400, { error: 'BAD_REQUEST: keyId must be a valid UUID' });
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

      const parsed = (await readJsonObject(req)) as Record<string, any>;
      const { workspaceId, resourceType, resourceId, permission, expiresInHours, validUntil } = parsed;

      if (!workspaceId) {
        sendJson(res, 400, { error: 'workspaceId is required' });
        return;
      }
      if (!requireUuid(res, workspaceId, 'workspaceId')) return;

      // Enforce workspace-scoped key restrictions before anything else.
      if (!keyWorkspaceMatches(auth, workspaceId)) {
        sendJson(res, 403, { error: 'FORBIDDEN: Key restricted to different workspace' });
        return;
      }

      // The server connects as a trusted role, so authorization is enforced here.
      const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
      if (!mem || !roleAllows(auth, mem.role, 'admin')) {
        sendJson(res, 403, { error: 'FORBIDDEN: Owner or admin role required to create share links' });
        return;
      }

      if (resourceType && resourceType !== 'gallery') {
        sendJson(res, 400, { error: "BAD_REQUEST: Only resourceType 'gallery' is supported currently" });
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
        // A large enough hour count overflows the Date range; refuse it rather than
        // letting toISOString() throw `Invalid time value` as a 500.
        if (!Number.isFinite(d.getTime())) {
          sendJson(res, 400, { error: 'BAD_REQUEST: expiresInHours is out of range' });
          return;
        }
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
      if (!requireUuid(res, workspaceId, 'workspaceId')) return;

      if (!keyWorkspaceMatches(auth, workspaceId)) {
        sendJson(res, 403, { error: 'FORBIDDEN: Key restricted to different workspace' });
        return;
      }

      const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
      if (!mem || !roleAllows(auth, mem.role, 'admin')) {
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
      if (!requireUuid(res, shareId, 'shareId')) return;
      if (!requireUuid(res, workspaceId, 'workspaceId')) return;

      if (!keyWorkspaceMatches(auth, workspaceId)) {
        sendJson(res, 403, { error: 'FORBIDDEN: Key restricted to different workspace' });
        return;
      }

      const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
      if (!mem || !roleAllows(auth, mem.role, 'admin')) {
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

      // The token has authorized this workspace read; bind the share creator so the
      // fenced file listing is scoped to exactly the shared workspace.
      bindRequestIdentity(share.createdBy, share.workspaceId);

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

    // 9b. Workspace-aware capability discovery.
    if (pathname === '/api/capabilities' && req.method === 'GET') {
      const auth = await authenticateRequest(req);
      if (!auth) {
        sendJson(res, 401, {
          error: 'UNAUTHENTICATED',
          code: 'UNAUTHENTICATED',
          message: 'A valid Octo credential is required.',
        });
        return;
      }

      const requestedWorkspaceId = url.searchParams.get('workspaceId');
      if (requestedWorkspaceId !== null && !UUID_PATTERN.test(requestedWorkspaceId)) {
        sendJson(res, 400, {
          error: 'INVALID_WORKSPACE_ID',
          code: 'INVALID_WORKSPACE_ID',
          message: 'workspaceId must be a UUID.',
        });
        return;
      }

      const scopes = auth.apiKey ? auth.apiKey.scopes : ['read', 'write', 'delete', 'files', 'admin'];
      let workspace: { id: string; role: WorkspaceRole } | null = null;
      let unavailable: { action: string; reason: 'PROVIDER_UNAVAILABLE' }[] = [];
      let capabilities = capabilitiesForScopes(scopes);

      if (requestedWorkspaceId) {
        if (!keyWorkspaceMatches(auth, requestedWorkspaceId)) {
          sendJson(res, 403, {
            error: 'WORKSPACE_ACCESS_DENIED',
            code: 'WORKSPACE_ACCESS_DENIED',
            message: 'This credential cannot access the requested workspace.',
          });
          return;
        }

        let mem;
        try {
          const exists = await dbGetWorkspaceById(requestedWorkspaceId);
          mem = exists ? await dbGetWorkspaceMembership(requestedWorkspaceId, auth.principal.id) : null;
        } catch {
          sendJson(res, 500, {
            error: 'CAPABILITY_LOOKUP_FAILED',
            code: 'CAPABILITY_LOOKUP_FAILED',
            message: 'Workspace capabilities could not be loaded.',
          });
          return;
        }
        if (!mem) {
          sendJson(res, 403, {
            error: 'WORKSPACE_ACCESS_DENIED',
            code: 'WORKSPACE_ACCESS_DENIED',
            message: 'This credential cannot access the requested workspace.',
          });
          return;
        }

        const role = effectiveWorkspaceRole(auth, mem.role);
        workspace = { id: requestedWorkspaceId, role };
        capabilities = capabilities.filter((capability) => {
          if (capability.action === 'workspaces.create') return !auth.apiKey?.workspaceId;
          return roleMeetsMinimum(role, minimumRoleForCapability(capability.action));
        });

        const providerByAction: Record<string, boolean> = {
          'files.download': Boolean(objectStore),
          'files.upload': Boolean(objectStore),
          'files.delete': Boolean(objectStore),
          'files.archive': Boolean(objectStore && archiveDeps),
          'files.restore': Boolean(objectStore && archiveDeps),
        };
        const supported = [] as typeof capabilities;
        for (const capability of capabilities) {
          const configured = providerByAction[capability.action];
          if (configured === false) unavailable.push({ action: capability.action, reason: 'PROVIDER_UNAVAILABLE' });
          else supported.push(capability);
        }
        capabilities = supported;
      } else if (auth.apiKey?.workspaceId) {
        capabilities = capabilities.filter((capability) => capability.action !== 'workspaces.create');
      }

      sendJson(res, 200, {
        contractVersion: 1,
        discoveryMode: requestedWorkspaceId ? 'workspace' : 'unbound',
        workspace,
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
        unavailable,
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

      const parsed = (await readJsonObject(req)) as Record<string, any>;
      const { workspaceId, jobType, idempotencyKey, payload } = parsed;

      if (!workspaceId || !jobType || !idempotencyKey) {
        sendJson(res, 400, { error: 'workspaceId, jobType, and idempotencyKey are required' });
        return;
      }
      if (!requireUuid(res, workspaceId, 'workspaceId')) return;
      if (jobType === 'archive_file' || jobType === 'restore_file') {
        sendJson(res, 400, { error: 'JOB_TYPE_RESERVED: use the file archive or restore route' });
        return;
      }
      if (!keyWorkspaceMatches(auth, workspaceId)) {
        sendJson(res, 403, { error: 'FORBIDDEN: Key restricted to different workspace' });
        return;
      }

      const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
      if (!mem || !roleAllows(auth, mem.role, 'operator')) {
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
      if (!requireUuid(res, workspaceId, 'workspaceId')) return;
      if (!keyWorkspaceMatches(auth, workspaceId)) {
        sendJson(res, 403, { error: 'FORBIDDEN: Key restricted to different workspace' });
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
      if (!requireScope(auth, 'read')) {
        scopeDenied(res, 'read');
        return;
      }

      const workspaceId = url.searchParams.get('workspaceId');
      if (!workspaceId) {
        sendJson(res, 400, { error: 'workspaceId is required' });
        return;
      }
      if (!requireUuid(res, workspaceId, 'workspaceId')) return;
      if (!keyWorkspaceMatches(auth, workspaceId)) {
        sendJson(res, 403, { error: 'FORBIDDEN: Key restricted to different workspace' });
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
      if (!requireScope(auth, 'write')) {
        scopeDenied(res, 'write');
        return;
      }

      const jobId = pathname.slice('/api/jobs/'.length, -'/retry'.length);
      const workspaceId = url.searchParams.get('workspaceId');
      if (!jobId || !workspaceId) {
        sendJson(res, 400, { error: 'jobId and workspaceId are required' });
        return;
      }
      if (!requireUuid(res, jobId, 'jobId')) return;
      if (!requireUuid(res, workspaceId, 'workspaceId')) return;

      if (!keyWorkspaceMatches(auth, workspaceId)) {
        sendJson(res, 403, { error: 'FORBIDDEN: Key restricted to different workspace' });
        return;
      }

      const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
      if (!mem || !roleAllows(auth, mem.role, 'admin')) {
        sendJson(res, 403, { error: 'FORBIDDEN: Owner or admin role required to retry jobs' });
        return;
      }

      const retry = await dbRetryJob(jobId, workspaceId);
      if (retry === 'busy') {
        sendJson(res, 409, { error: 'FILE_BUSY: archive or restore is in progress' });
        return;
      }
      if (retry !== 'requeued') {
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
      if (!requireScope(auth, 'write')) {
        scopeDenied(res, 'write');
        return;
      }

      const workspaceId = url.searchParams.get('workspaceId');
      if (!workspaceId) {
        sendJson(res, 400, { error: 'workspaceId is required' });
        return;
      }
      if (!requireUuid(res, workspaceId, 'workspaceId')) return;
      if (!keyWorkspaceMatches(auth, workspaceId)) {
        sendJson(res, 403, { error: 'FORBIDDEN: Key restricted to different workspace' });
        return;
      }

      const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
      if (!mem || !roleAllows(auth, mem.role, 'operator')) {
        sendJson(res, 403, { error: 'FORBIDDEN: Operator role or higher required to run jobs' });
        return;
      }

      const outcomes = await drainQueueOnce(workspaceId);
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

      // Authorize before probing provider configuration: an unauthorized caller
      // must not learn whether embeddings are configured.
      const parsed = (await readJsonObject(req)) as Record<string, any>;
      const { workspaceId, title, text, mimeType } = parsed;

      if (!workspaceId || !title || typeof text !== 'string') {
        sendJson(res, 400, { error: 'workspaceId, title, and text are required' });
        return;
      }
      if (!requireUuid(res, workspaceId, 'workspaceId')) return;

      if (!keyWorkspaceMatches(auth, workspaceId)) {
        sendJson(res, 403, { error: 'FORBIDDEN: Key restricted to different workspace' });
        return;
      }

      const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
      if (!mem || !roleAllows(auth, mem.role, 'operator')) {
        sendJson(res, 403, { error: 'FORBIDDEN: Operator role or higher required to ingest documents' });
        return;
      }

      const embeddingConfig = loadEmbeddingConfigFromEnv();
      if (!embeddingConfig) {
        sendJson(res, 503, {
          error: 'EMBEDDING_PROVIDER_NOT_CONFIGURED: set OCTO_EMBEDDING_API_KEY to ingest documents',
        });
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

      const parsed = (await readJsonObject(req)) as Record<string, any>;
      const { workspaceId, query, limit } = parsed;

      if (!workspaceId || !query) {
        sendJson(res, 400, { error: 'workspaceId and query are required' });
        return;
      }
      if (!requireUuid(res, workspaceId, 'workspaceId')) return;

      if (!keyWorkspaceMatches(auth, workspaceId)) {
        sendJson(res, 403, { error: 'FORBIDDEN: Key restricted to different workspace' });
        return;
      }

      const mem = await dbGetWorkspaceMembership(workspaceId, auth.principal.id);
      if (!mem) {
        sendJson(res, 403, { error: 'FORBIDDEN: Not a member of this workspace' });
        return;
      }

      // Authorize before probing provider configuration: an unauthorized caller
      // must not learn whether embeddings are configured.
      const embeddingConfig = loadEmbeddingConfigFromEnv();
      if (!embeddingConfig) {
        sendJson(res, 503, {
          error: 'EMBEDDING_PROVIDER_NOT_CONFIGURED: set OCTO_EMBEDDING_API_KEY to query documents',
        });
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

    // Static asset serving if dist/ directory exists (standalone/production)
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath) && req.method === 'GET') {
      const relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const filePath = path.join(distPath, relPath);
      const normalizedDist = distPath.endsWith(path.sep) ? distPath : distPath + path.sep;
      // Prevent path traversal
      if ((filePath === distPath || filePath.startsWith(normalizedDist)) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const contentTypes: Record<string, string> = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'application/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.json': 'application/json; charset=utf-8',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon',
          '.webp': 'image/webp',
          '.woff': 'font/woff',
          '.woff2': 'font/woff2',
          '.ttf': 'font/ttf',
        };
        const contentType = contentTypes[ext] ?? 'application/octet-stream';
        sendStaticFile(res, filePath, contentType);
        return;
      }

      // SPA fallback for HTML navigation requests (excluding /api routes)
      const indexPath = path.join(distPath, 'index.html');
      if (!pathname.startsWith('/api/') && fs.existsSync(indexPath) && (!path.extname(pathname) || req.headers.accept?.includes('text/html'))) {
        sendStaticFile(res, indexPath, 'text/html; charset=utf-8');
        return;
      }
    }

    // 404 for unknown route
    sendJson(res, 404, { error: `Not found: ${req.method} ${pathname}` });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { error: `INTERNAL_SERVER_ERROR: ${message}` });
  }
}

// Every request runs inside a fresh identity holder so concurrent requests can
// never share RLS claims. `authenticateRequest` fills it in; `query()` binds it,
// transaction-scoped, on the fenced app pool.
export const server = createServer((req, res) => {
  void runWithRequestIdentity(() => handleRequest(req, res));
});

// Start listening if run directly. Compare on the basename so the guard holds on
// Windows too, where argv[1] is a backslash path and never matches 'server/index.ts'.
const entryFile = process.argv[1] ? path.basename(process.argv[1]) : '';
if (
  (entryFile === 'index.ts' || entryFile === 'index.js') &&
  path.basename(path.dirname(process.argv[1]!)) === 'server'
) {
  server.listen(PORT, () => {
    console.log(`Octo Platform Server listening on http://localhost:${PORT}`);
    console.log(`- Health: http://localhost:${PORT}/health`);
    console.log(`- Guest Login: POST http://localhost:${PORT}/api/auth/guest`);
    console.log(`- R2 Active Bucket: ${r2Provider ? r2Provider.bucket : 'none'}`);
    // Apply the retention policy once at boot, then on the hourly tick, so a
    // deployment does not wait up to an hour to honour an existing window.
    void runRetentionSweep()
      .then((enqueued) => {
        if (enqueued > 0) console.log(`Retention sweep enqueued ${enqueued} archive job(s)`);
      })
      .catch((err) => console.warn('Retention sweep failed:', err));
    startSchedulers();
  });
}
