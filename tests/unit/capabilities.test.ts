/**
 * Unit Tests: Agent capability discovery and scope model (Slice 7)
 */

import { describe, expect, it } from 'vitest';
import {
  AUTH_GUIDANCE,
  capabilitiesForScopes,
  hasScope,
  OCTO_CAPABILITIES,
} from '../../src/api/capabilities';

describe('Capability discovery', () => {
  it('offers a stable, non-empty surface', () => {
    expect(OCTO_CAPABILITIES.length).toBeGreaterThan(0);
    const actions = OCTO_CAPABILITIES.map((c) => c.action);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it('filters capabilities to the granted scopes', () => {
    const readOnly = capabilitiesForScopes(['read']);
    // A read-only token sees only read-scoped capabilities.
    expect(readOnly.every((c) => c.requiredScope === 'read')).toBe(true);
    expect(readOnly.some((c) => c.action === 'workspaces.list')).toBe(true);
    expect(readOnly.some((c) => c.action === 'files.delete')).toBe(false);

    const full = capabilitiesForScopes(['read', 'write', 'delete', 'files']);
    expect(full.some((c) => c.action === 'files.delete')).toBe(true);
    expect(full.some((c) => c.action === 'files.upload')).toBe(true);
  });

  it('never exposes a destructive action to a token without the delete scope', () => {
    for (const scopes of [['read'], ['files'], ['read', 'files'], ['read', 'write', 'files']]) {
      const caps = capabilitiesForScopes(scopes);
      expect(caps.some((c) => c.requiredScope === 'delete')).toBe(false);
    }
  });

  it('enforces scope membership', () => {
    expect(hasScope(['read', 'files'], 'files')).toBe(true);
    expect(hasScope(['read'], 'delete')).toBe(false);
    expect(hasScope([], 'read')).toBe(false);
  });

  it('describes authentication without disclosing any credential', () => {
    const serialized = JSON.stringify(AUTH_GUIDANCE);
    expect(serialized).toContain('Bearer');
    // No provider, database, or infrastructure secret shape appears.
    expect(serialized).not.toMatch(/CLOUDFLARE_SECRET|SERVICE_ROLE|password|refresh_token/i);
  });
});
