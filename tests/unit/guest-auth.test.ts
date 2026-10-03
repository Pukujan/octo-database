/**
 * Unit Tests: Guest Authentication & Auto-Provisioning
 */

import { describe, expect, it } from 'vitest';
import { loginAsGuest, resolveCurrentPrincipal } from '../../src/auth/session';
import { listAuthorizedWorkspaces } from '../../src/auth/authorization';
import { createMockSupabaseClient, MockDatabase } from '../mocks/mock-supabase';

describe('Guest Authentication Flow', () => {
  it('authenticates guest, creates guest principal, and provisions guest workspace', async () => {
    const db = new MockDatabase();
    const client = createMockSupabaseClient(db, null);

    // 1. Log in as Guest
    const guestPrincipal = await loginAsGuest(client, 'Anonymous Explorer');

    expect(guestPrincipal).toBeDefined();
    expect(guestPrincipal.isGuest).toBe(true);
    expect(guestPrincipal.displayName).toBe('Anonymous Explorer');
    expect(guestPrincipal.email).toMatch(/^guest-[a-z0-9-]+@octo\.local$/);

    // Verify in database
    const dbPrincipal = db.principals.find((p) => p.id === guestPrincipal.id);
    expect(dbPrincipal).toBeDefined();
    expect(dbPrincipal?.is_guest).toBe(true);

    // Verify auto-provisioned workspace
    const guestWorkspaces = db.workspaces.filter((w) => w.created_by === guestPrincipal.id);
    expect(guestWorkspaces.length).toBe(1);
    expect(guestWorkspaces[0].name).toBe('Personal (Guest)');

    // Verify owner membership
    const membership = db.memberships.find(
      (m) => m.workspace_id === guestWorkspaces[0].id && m.principal_id === guestPrincipal.id
    );
    expect(membership).toBeDefined();
    expect(membership?.role).toBe('owner');
  });
});
