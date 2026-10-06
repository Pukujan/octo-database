/**
 * Signed Session Tokens (ISS-1)
 *
 * A bearer session token must be unguessable and expiring. A raw principal UUID
 * is neither: it is handed to the client at login and (until ISS-3) also appears
 * in media query strings, so accepting it directly as a bearer credential means
 * anyone who observes a principal id can act as that principal.
 *
 * The token is an HMAC-signed, expiring envelope around the principal id:
 *   octo_sess_<principalId>.<exp>.<sig>
 * Nothing is stored server-side; expiry is the only revocation. That is the
 * minimum that closes the disclosure channel without a sessions table.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const TOKEN_PREFIX = 'octo_sess_';
const DEFAULT_TTL_SECONDS = 7 * 24 * 3600;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Read the secret lazily so tests can set it per case. When it is absent, fall
// back to a per-process secret: CI/dev run one process, and failing closed would
// lock every login out of a deployment that has not set the variable yet.
let fallbackSecret: string | undefined;
let warned = false;

function sessionSecret(): string {
  const configured = process.env['OCTO_SESSION_SECRET'];
  if (configured) return configured;

  if (!fallbackSecret) {
    fallbackSecret = randomBytes(32).toString('hex');
    if (!warned) {
      warned = true;
      console.warn('OCTO_SESSION_SECRET unset: session tokens will be invalidated on restart.');
    }
  }
  return fallbackSecret;
}

function sign(principalId: string, expiresAt: number): string {
  return createHmac('sha256', sessionSecret())
    .update(`session:${principalId}:${expiresAt}`)
    .digest('base64url');
}

/** Mints a signed, expiring session token for a principal. */
export function signSessionToken(principalId: string, ttlSeconds = DEFAULT_TTL_SECONDS): string {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `${TOKEN_PREFIX}${principalId}.${expiresAt}.${sign(principalId, expiresAt)}`;
}

/** Verifies a session token. Returns the principal id, or null when invalid/expired. */
export function verifySessionToken(token: string): string | null {
  if (!token.startsWith(TOKEN_PREFIX)) return null;

  const parts = token.slice(TOKEN_PREFIX.length).split('.');
  if (parts.length !== 3) return null;

  const [principalId, exp, sig] = parts;
  if (!principalId || !exp || !sig) return null;
  if (!UUID_PATTERN.test(principalId)) return null;

  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return null;

  const expected = sign(principalId, expiresAt);
  const providedBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
    return null;
  }
  return principalId;
}
