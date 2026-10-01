/**
 * Signed Media URL Tokens (Slice 3)
 *
 * Image/video elements cannot attach an Authorization header, so media URLs carry
 * a short-lived HMAC signature scoped to one file + workspace + principal instead.
 * This keeps originals private while letting the browser fetch derivatives directly.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const DEFAULT_TTL_SECONDS = 3600;

// Persistent secret when provided; otherwise a per-process secret. A per-process
// secret is fine for CI/dev (one process) but invalidates media URLs on restart,
// so self-hosted deployments should set OCTO_MEDIA_SECRET.
const MEDIA_SECRET = process.env['OCTO_MEDIA_SECRET'] ?? randomBytes(32).toString('hex');
if (!process.env['OCTO_MEDIA_SECRET']) {
  console.warn('OCTO_MEDIA_SECRET unset: media URLs will be invalidated on restart.');
}

export interface MediaTokenClaims {
  fileId: string;
  workspaceId: string;
  principalId: string;
  expiresAt: number;
}

function sign(payload: string): string {
  return createHmac('sha256', MEDIA_SECRET).update(payload).digest('base64url');
}

/** Builds a signed, expiring query string for a media route. */
export function signMediaUrl(
  path: string,
  claims: Omit<MediaTokenClaims, 'expiresAt'>,
  ttlSeconds = DEFAULT_TTL_SECONDS
): string {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${claims.fileId}:${claims.workspaceId}:${claims.principalId}:${expiresAt}`;
  const params = new URLSearchParams({
    fileId: claims.fileId,
    workspaceId: claims.workspaceId,
    principalId: claims.principalId,
    exp: String(expiresAt),
    sig: sign(payload),
  });
  return `${path}?${params.toString()}`;
}

/** Verifies a signed media URL. Returns the claims, or null when invalid/expired. */
export function verifyMediaToken(
  fileId: string | null,
  workspaceId: string | null,
  principalId: string | null,
  exp: string | null,
  sig: string | null
): MediaTokenClaims | null {
  if (!fileId || !workspaceId || !principalId || !exp || !sig) return null;

  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  const expected = sign(`${fileId}:${workspaceId}:${principalId}:${expiresAt}`);
  const provided = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (provided.length !== expectedBuf.length || !timingSafeEqual(provided, expectedBuf)) {
    return null;
  }

  return { fileId, workspaceId, principalId, expiresAt };
}
