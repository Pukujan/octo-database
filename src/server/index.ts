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
import { randomUUID } from 'crypto';
import { loadR2ConfigFromEnv, R2StorageProvider } from '../storage/r2-client';
import { hashApiKeySecret } from '../api/keys';
import {
  dbDeleteFile,
  dbGetAuthorizedWorkspaces,
  dbGetFile,
  dbGetWorkspaceMembership,
  dbInsertApiKey,
  dbInsertFile,
  dbInsertGuestPrincipal,
  dbInsertMembership,
  dbInsertWorkspace,
  dbListApiKeys,
  dbListWorkspaceFiles,
  dbVerifyApiKey,
  query,
  testDbConnection,
} from './db';
import { Principal, WorkspaceRole } from '../types/auth';

const PORT = parseInt(process.env['PORT'] ?? '3001', 10);

// Initialize R2 Active Storage Provider
let r2Provider: R2StorageProvider | null = null;
try {
  const r2Config = loadR2ConfigFromEnv();
  r2Provider = new R2StorageProvider(r2Config);
} catch (e) {
  console.warn('R2 storage initialization note:', (e as Error).message);
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

  // 2. Direct session / principal ID token (e.g. from guest login)
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
      });
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

      const bodyStr = await readBody(req);
      const parsed = JSON.parse(bodyStr);
      const { workspaceId, name, mimeType, data } = parsed;

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

      // Upload bytes to Cloudflare R2 bucket (with local fallback if cloud credentials absent)
      let sizeBytes = Buffer.byteLength(data);
      let etag: string | null = null;

      if (r2Provider) {
        const putResult = await r2Provider.putObject(storageKey, data, mimeType ?? 'application/octet-stream');
        sizeBytes = putResult.sizeBytes;
        etag = putResult.etag?.replace(/"/g, '') ?? null;
      } else {
        const localPath = path.join('/tmp', 'octo-storage', storageKey);
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        fs.writeFileSync(localPath, data);
        etag = `local-${Date.now()}`;
      }
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
        : `http://localhost:${PORT}/api/files/download?fileId=${fileId}&workspaceId=${workspaceId}`;
      sendJson(res, 200, { file, downloadUrl });
      return;
    }

    // 7. File Delete: DELETE /api/files/:id
    if (pathname.startsWith('/api/files/') && req.method === 'DELETE') {
      const auth = await authenticateRequest(req);
      if (!auth) {
        sendJson(res, 401, { error: 'UNAUTHENTICATED' });
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

      if (r2Provider) {
        await r2Provider.deleteObject(deleted.storageKey);
      }

      sendJson(res, 200, { success: true, fileId });
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
      const { name, workspaceId } = parsed;

      if (!name) {
        sendJson(res, 400, { error: 'name is required' });
        return;
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

      const keyId = randomUUID();
      await dbInsertApiKey(
        keyId,
        keyHash,
        prefix,
        name,
        auth.principal.id,
        workspaceId ?? null,
        isAccountWide ? 'owner' : 'member',
        ['read', 'write', 'files']
      );

      sendJson(res, 201, {
        apiKey: {
          id: keyId,
          prefix,
          name,
          workspaceId: workspaceId ?? null,
          isAccountWide,
          scopes: ['read', 'write', 'files'],
        },
        rawSecret,
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
