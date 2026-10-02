/**
 * Unit Tests: Agent capability discovery and scope model (Slice 7)
 */

import { describe, expect, it } from 'vitest';
import {
  ADMIN_CAPABILITIES,
  AUTH_GUIDANCE,
  capabilitiesForScopes,
  hasScope,
  OCTO_CAPABILITIES,
  SCOPE_PRESETS,
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

  it('advertises workspace create and the archive/restore transitions', () => {
    const byAction = new Map(OCTO_CAPABILITIES.map((c) => [c.action, c]));
    expect(byAction.get('workspaces.create')?.requiredScope).toBe('write');
    expect(byAction.get('files.archive')?.requiredScope).toBe('delete');
    expect(byAction.get('files.restore')?.requiredScope).toBe('write');
    expect(byAction.get('activity.list')?.requiredScope).toBe('read');
    expect(byAction.get('keys.revoke')?.requiredScope).toBe('delete');
  });

  it('keeps admin-scoped capabilities out of the ordinary surface', () => {
    expect(ADMIN_CAPABILITIES.length).toBeGreaterThan(0);
    expect(ADMIN_CAPABILITIES.every((c) => c.requiredScope === 'admin')).toBe(true);
    // admin never appears among the capabilities a normal scope list can reach.
    const reachable = capabilitiesForScopes(['read', 'write', 'delete', 'files']);
    expect(reachable.some((c) => c.requiredScope === 'admin')).toBe(false);
  });

  it('defines presets that map only onto real scopes', () => {
    const realScopes = new Set(OCTO_CAPABILITIES.map((c) => c.requiredScope));
    expect(SCOPE_PRESETS.length).toBeGreaterThan(0);
    for (const preset of SCOPE_PRESETS) {
      expect(preset.scopes.length).toBeGreaterThan(0);
      for (const scope of preset.scopes) {
        expect(realScopes.has(scope)).toBe(true);
      }
    }
    // The Full preset is the only one that grants destructive authority.
    const withDelete = SCOPE_PRESETS.filter((p) => p.scopes.includes('delete'));
    expect(withDelete.map((p) => p.id)).toEqual(['full']);
  });
});
