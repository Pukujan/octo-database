/**
 * Signed Media URL Tokens (Slices 3 and 4)
 *
 * `img`/`video` elements cannot attach an Authorization header, so media URLs carry
 * a short-lived HMAC signature instead. Two scopes exist:
 *
 *   - principal: bound to one principal's live workspace membership.
 *   - share:     bound to one share link, for logged-out recipients.
 *
 * The share scope deliberately carries no principal, and every use re-checks the
 * share is still valid, so revoking or expiring a link also kills its media URLs.
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

export interface PrincipalMediaClaims {
  kind: 'principal';
  fileId: string;
  workspaceId: string;
  principalId: string;
}

export interface ShareMediaClaims {
  kind: 'share';
  fileId: string;
  workspaceId: string;
  shareId: string;
}

export type MediaClaims = PrincipalMediaClaims | ShareMediaClaims;

function sign(payload: string): string {
  return createHmac('sha256', MEDIA_SECRET).update(payload).digest('base64url');
}

function encodeClaims(claims: MediaClaims, expiresAt: number): string {
  return claims.kind === 'principal'
    ? `principal:${claims.fileId}:${claims.workspaceId}:${claims.principalId}:${expiresAt}`
    : `share:${claims.fileId}:${claims.workspaceId}:${claims.shareId}:${expiresAt}`;
}

/**
 * Builds a signed, expiring query string for a media route.
 * A share-scoped URL is additionally capped at the share's own expiry so the media
 * link can never outlive the authorization that produced it.
 */
export function signMediaUrl(
  path: string,
  claims: MediaClaims,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  notAfter?: string | null
): string {
  let expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;

  if (notAfter) {
    const cap = Math.floor(new Date(notAfter).getTime() / 1000);
    if (Number.isFinite(cap)) expiresAt = Math.min(expiresAt, cap);
  }

  const payload = encodeClaims(claims, expiresAt);
  const params = new URLSearchParams({
    fileId: claims.fileId,
    workspaceId: claims.workspaceId,
    exp: String(expiresAt),
    sig: sign(payload),
  });

  if (claims.kind === 'principal') {
    params.set('principalId', claims.principalId);
  } else {
    params.set('shareId', claims.shareId);
  }

  return `${path}?${params.toString()}`;
}

/** Verifies a signed media URL. Returns the claims, or null when invalid/expired. */
export function verifyMediaToken(params: URLSearchParams): MediaClaims | null {
  const fileId = params.get('fileId');
  const workspaceId = params.get('workspaceId');
  const exp = params.get('exp');
  const sig = params.get('sig');
  const principalId = params.get('principalId');
  const shareId = params.get('shareId');

  if (!fileId || !workspaceId || !exp || !sig) return null;

  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  let claims: MediaClaims;
  if (principalId) {
    claims = { kind: 'principal', fileId, workspaceId, principalId };
  } else if (shareId) {
    claims = { kind: 'share', fileId, workspaceId, shareId };
  } else {
    return null;
  }

  const expected = sign(encodeClaims(claims, expiresAt));
  const provided = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (provided.length !== expectedBuf.length || !timingSafeEqual(provided, expectedBuf)) {
    return null;
  }

  return claims;
}
