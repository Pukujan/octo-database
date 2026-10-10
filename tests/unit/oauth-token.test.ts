/**
 * Unit Tests: OAuth access tokens (MCP authorization server).
 *
 * The access token is the credential a remote MCP client presents at /mcp. These
 * pin the properties that make it safe: it only verifies under the key that
 * signed it, it expires, and its audience binding refuses a token minted for a
 * different resource (RFC 8707) -- the check that stops a token for one resource
 * being replayed at another.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  signOAuthAccessToken,
  verifyOAuthAccessToken,
  oauthIssuer,
  oauthResource,
} from '../../src/lib/oauth-token';

const PRINCIPAL = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const WORKSPACE = '11111111-2222-4333-8444-555555555555';

describe('OAuth access tokens', () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env['OCTO_OAUTH_SECRET'] = 'unit-test-oauth-secret';
    process.env['PUBLIC_BASE_URL'] = 'https://octodb.example.com';
  });
  afterEach(() => {
    process.env = { ...original };
  });

  it('round-trips a signed token with its claims intact', () => {
    const { token, expiresIn } = signOAuthAccessToken({
      principalId: PRINCIPAL,
      workspaceId: WORKSPACE,
      scopes: ['read'],
      resource: oauthResource(),
    });
    expect(expiresIn).toBe(3600);
    const verified = verifyOAuthAccessToken(token, oauthResource());
    expect(verified).not.toBeNull();
    expect(verified!.claims.sub).toBe(PRINCIPAL);
    expect(verified!.claims.workspace_id).toBe(WORKSPACE);
    expect(verified!.claims.scope).toBe('read');
    expect(verified!.claims.aud).toBe('https://octodb.example.com/mcp');
    expect(verified!.claims.iss).toBe('https://octodb.example.com');
  });

  it('refuses a token minted for a different resource (audience binding)', () => {
    const { token } = signOAuthAccessToken({
      principalId: PRINCIPAL,
      workspaceId: WORKSPACE,
      scopes: ['read'],
      resource: 'https://octodb.example.com/other',
    });
    expect(verifyOAuthAccessToken(token, oauthResource())).toBeNull();
  });

  it('refuses a tampered signature', () => {
    const { token } = signOAuthAccessToken({
      principalId: PRINCIPAL,
      workspaceId: WORKSPACE,
      scopes: ['read'],
      resource: oauthResource(),
    });
    const parts = token.split('.');
    const flipped = parts[2]!.slice(0, -1) + (parts[2]!.endsWith('A') ? 'B' : 'A');
    expect(verifyOAuthAccessToken(`${parts[0]}.${parts[1]}.${flipped}`, oauthResource())).toBeNull();
  });

  it('refuses a token signed under a different secret', () => {
    const { token } = signOAuthAccessToken({
      principalId: PRINCIPAL,
      workspaceId: WORKSPACE,
      scopes: ['read'],
      resource: oauthResource(),
    });
    process.env['OCTO_OAUTH_SECRET'] = 'a-different-secret';
    expect(verifyOAuthAccessToken(token, oauthResource())).toBeNull();
  });

  it('refuses an expired token', () => {
    vi.useFakeTimers();
    try {
      const { token } = signOAuthAccessToken({
        principalId: PRINCIPAL,
        workspaceId: WORKSPACE,
        scopes: ['read'],
        resource: oauthResource(),
      });
      expect(verifyOAuthAccessToken(token, oauthResource())).not.toBeNull();
      vi.advanceTimersByTime(3601 * 1000);
      expect(verifyOAuthAccessToken(token, oauthResource())).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a token whose issuer does not match', () => {
    const { token } = signOAuthAccessToken({
      principalId: PRINCIPAL,
      workspaceId: WORKSPACE,
      scopes: ['read'],
      resource: oauthResource(),
    });
    process.env['PUBLIC_BASE_URL'] = 'https://other.example.com';
    expect(verifyOAuthAccessToken(token, oauthResource())).toBeNull();
  });

  it('refuses a malformed token rather than throwing', () => {
    expect(verifyOAuthAccessToken('not-a-jwt', oauthResource())).toBeNull();
    expect(verifyOAuthAccessToken('eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.', oauthResource())).toBeNull();
  });

  it('derives issuer and resource from PUBLIC_BASE_URL', () => {
    expect(oauthIssuer()).toBe('https://octodb.example.com');
    expect(oauthResource()).toBe('https://octodb.example.com/mcp');
  });
});
