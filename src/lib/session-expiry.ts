/**
 * Client-safe session expiry helpers.
 *
 * `session-token.ts` signs and verifies tokens but imports node `crypto`, so the
 * browser cannot use it. The client only needs to read the expiry the server
 * already embedded in the token, which is a pure string operation — kept here so
 * the UI can warn before, and react after, a session ends without pulling the
 * signing code into the bundle.
 */

export const SESSION_TOKEN_PREFIX = 'octo_sess_';

/** The token's expiry as epoch milliseconds, or null when it is not a session token. */
export function sessionExpiryMs(token: string | null | undefined): number | null {
  if (!token || !token.startsWith(SESSION_TOKEN_PREFIX)) return null;
  const parts = token.slice(SESSION_TOKEN_PREFIX.length).split('.');
  if (parts.length !== 3) return null;
  const expiresAt = Number(parts[1]);
  return Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt * 1000 : null;
}

/** True when the token is a well-formed session token whose expiry has passed. */
export function isSessionExpired(token: string | null | undefined, nowMs: number): boolean {
  const expiry = sessionExpiryMs(token);
  return expiry !== null && expiry <= nowMs;
}
