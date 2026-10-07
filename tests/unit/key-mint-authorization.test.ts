/**
 * Unit tests: key-minting authority (no privilege escalation).
 *
 * A token may only ever narrow its own authority when minting another key. It
 * must never be able to escape a workspace binding, mint an account-wide key
 * from a workspace-bound one, or grant a scope it does not itself hold.
 */

import { describe, expect, it } from 'vitest';
import { authorizeKeyMint, parseKeyScopes } from '../../src/api/keys';

const WS_A = '11111111-1111-4111-8111-111111111111';
const WS_B = '22222222-2222-4222-8222-222222222222';

describe('parseKeyScopes', () => {
  it('keeps a granular allowance list and drops duplicates', () => {
    expect(parseKeyScopes(['read', 'delete', 'read'])).toEqual({ ok: true, scopes: ['read', 'delete'] });
  });

  it('refuses an empty list and an unknown allowance', () => {
    expect(parseKeyScopes([])).toEqual({ ok: false, error: 'BAD_REQUEST: scopes must be a non-empty array' });
    expect(parseKeyScopes(['publish'])).toEqual({ ok: false, error: 'BAD_REQUEST: unknown scopes: publish' });
  });
});

describe('authorizeKeyMint', () => {
  it('leaves a human session unconstrained', () => {
    const decision = authorizeKeyMint(
      { isApiKey: false, workspaceId: null, scopes: [] },
      { workspaceId: null, scopes: ['read', 'write', 'files', 'delete'] }
    );
    expect(decision).toEqual({ ok: true, workspaceId: null, scopes: ['read', 'write', 'files', 'delete'] });
  });

  it('refuses a read-only token even for a workspace-bound mint', () => {
    const decision = authorizeKeyMint(
      { isApiKey: true, workspaceId: WS_A, scopes: ['read', 'files'] },
      { workspaceId: WS_A, scopes: ['read'] }
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) throw new Error('expected refusal');
    expect(decision.status).toBe(403);
    expect(decision.error).toMatch(/write/);
  });

  it('refuses a workspace-bound token minting an account-wide key', () => {
    const decision = authorizeKeyMint(
      { isApiKey: true, workspaceId: WS_A, scopes: ['read', 'write', 'files'] },
      { workspaceId: null, scopes: ['read'] }
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) throw new Error('expected refusal');
    expect(decision.status).toBe(403);
  });

  it('refuses a workspace-bound token minting into another workspace', () => {
    const decision = authorizeKeyMint(
      { isApiKey: true, workspaceId: WS_A, scopes: ['read', 'write', 'files'] },
      { workspaceId: WS_B, scopes: ['read'] }
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) throw new Error('expected refusal');
    expect(decision.status).toBe(403);
  });

  it('allows a workspace-bound token to narrow within its own workspace', () => {
    const decision = authorizeKeyMint(
      { isApiKey: true, workspaceId: WS_A, scopes: ['read', 'write', 'files'] },
      { workspaceId: WS_A, scopes: ['read', 'files'] }
    );
    expect(decision).toEqual({ ok: true, workspaceId: WS_A, scopes: ['read', 'files'] });
  });

  it('refuses an account-wide token granting a scope it does not hold', () => {
    const decision = authorizeKeyMint(
      { isApiKey: true, workspaceId: null, scopes: ['write'] },
      { workspaceId: null, scopes: ['read', 'write', 'files'] }
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) throw new Error('expected refusal');
    expect(decision.status).toBe(403);
    expect(decision.error).toMatch(/files|read/);
  });

  it('allows an account-wide token to mint within its own scopes', () => {
    const decision = authorizeKeyMint(
      { isApiKey: true, workspaceId: null, scopes: ['read', 'write', 'files'] },
      { workspaceId: WS_A, scopes: ['read', 'files'] }
    );
    expect(decision).toEqual({ ok: true, workspaceId: WS_A, scopes: ['read', 'files'] });
  });
});
