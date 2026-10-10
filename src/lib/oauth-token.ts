/**
 * OAuth 2.1 access tokens for the MCP endpoint (stateless HMAC JWTs).
 *
 * A client that finishes the authorization-code + PKCE dance at /oauth/*
 * receives an access token signed here. The token is a minimal JWT:
 *   base64url(header).base64url(payload).base64url(HMAC-SHA256)
 * with the header pinned to {"alg":"HS256","typ":"JWT"} — no `alg` negotiation,
 * which is the classic JWT downgrade hole. Verification recomputes the HMAC
 * over exactly the bytes received, checks exp and aud, and returns the claims.
 *
 * Claims:
 *   iss  — the Octo origin (the authorization server)
 *   sub  — the Octo principal id
 *   aud  — the MCP resource identifier (<issuer>/mcp); a token minted for one
 *          resource is refused at another (RFC 8707 audience binding)
 *   scope — space-separated Octo scopes ('read', ...)
 *   workspace_id — the one workspace the token acts in
 *   exp, iat, jti
 *
 * The signing key is OCTO_OAUTH_SECRET. Read lazily like the session secret:
 * unset falls back to a per-process random key with a warning, so dev/CI still
 * work and a deployment that has not set it yet only loses tokens across
 * restarts.
 */

import { createHmac, randomBytes, timingSafeEqual, randomUUID } from 'crypto';
const ACCESS_TOKEN_TTL_SECONDS = 3600;

export interface OAuthAccessTokenClaims {
  iss: string;
  sub: string;
  aud: string;
  scope: string;
  workspace_id: string;
  exp: number;
  iat: number;
  jti: string;
}

let fallbackSecret: string | undefined;
let warned = false;

function oauthSecret(): string {
  const configured = process.env['OCTO_OAUTH_SECRET'];
  if (configured) return configured;
  if (!fallbackSecret) {
    fallbackSecret = randomBytes(32).toString('hex');
    if (!warned) {
      warned = true;
      console.warn('OCTO_OAUTH_SECRET unset: OAuth access tokens will be invalidated on restart.');
    }
  }
  return fallbackSecret;
}

/** The OAuth issuer: the Octo public origin. */
export function oauthIssuer(): string {
  return (process.env['PUBLIC_BASE_URL'] ?? `http://localhost:${process.env['PORT'] ?? '3001'}`)
    .replace(/\/+$/, '');
}

/** The MCP protected-resource identifier: the issuer plus the resource path. */
export function oauthResource(): string {
  return `${oauthIssuer()}/mcp`;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function hmac(data: string): Buffer {
  return createHmac('sha256', oauthSecret()).update(data).digest();
}

export function signOAuthAccessToken(params: {
  principalId: string;
  workspaceId: string;
  scopes: string[];
  resource: string;
}): { token: string; jti: string; expiresIn: number } {
  const now = Math.floor(Date.now() / 1000);
  const jti = randomUUID();
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload: OAuthAccessTokenClaims = {
    iss: oauthIssuer(),
    sub: params.principalId,
    aud: params.resource,
    scope: params.scopes.join(' '),
    workspace_id: params.workspaceId,
    exp: now + ACCESS_TOKEN_TTL_SECONDS,
    iat: now,
    jti,
  };
  const body = `${header}.${b64url(JSON.stringify(payload))}`;
  const signature = b64url(hmac(body));
  return { token: `${body}.${signature}`, jti, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

export interface VerifiedAccessToken {
  claims: OAuthAccessTokenClaims;
}

/**
 * Verifies signature, expiry and audience. `expectedAudience` is the resource
 * identifier of the endpoint accepting the token. Returns null on any failure;
 * callers answer 401, never 500, on a malformed token.
 */
export function verifyOAuthAccessToken(
  token: string,
  expectedAudience: string
): VerifiedAccessToken | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts as [string, string, string];

  // Pin the header: refuse anything that is not exactly the HS256 JWT this
  // module mints, so no alternate algorithm can be negotiated.
  if (header !== b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))) return null;

  const expected = b64url(hmac(`${header}.${payload}`));
  const provided = signature;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
    return null;
  }

  let claims: OAuthAccessTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OAuthAccessTokenClaims;
  } catch {
    return null;
  }
  if (!claims || typeof claims !== 'object') return null;
  if (claims.iss !== oauthIssuer()) return null;
  if (claims.aud !== expectedAudience) return null;
  if (!Number.isFinite(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)) return null;
  if (typeof claims.sub !== 'string' || !claims.sub) return null;
  if (typeof claims.workspace_id !== 'string' || !claims.workspace_id) return null;
  if (typeof claims.scope !== 'string' || !claims.scope) return null;
  return { claims };
}
