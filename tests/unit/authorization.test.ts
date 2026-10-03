/**
 * Unit Tests: Authorization Logic & Session Lifecycle (Slice 1)
 */

import { describe, expect, it } from 'vitest';
import { User } from '@supabase/supabase-js';
import { ROLE_HIERARCHY, WorkspaceRole } from '../../src/types/auth';
import { hasMinimumRole } from '../../src/auth/authorization';
import { resolveCurrentPrincipal, signInWithGoogle, signOut } from '../../src/auth/session';
import { createMockSupabaseClient, MockDatabase } from '../mocks/mock-supabase';

describe('Role Hierarchy & Minimum Role', () => {
  it('strictly orders roles from owner down to member', () => {
    expect(ROLE_HIERARCHY.owner).toBeGreaterThan(ROLE_HIERARCHY.admin);
    expect(ROLE_HIERARCHY.admin).toBeGreaterThan(ROLE_HIERARCHY.operator);
    expect(ROLE_HIERARCHY.operator).toBeGreaterThan(ROLE_HIERARCHY.member);
  });

  it('evaluates minimum role correctly against active membership', async () => {
    const db = new MockDatabase();
    const user: User = {
      id: 'auth-user-1',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    };

    db.principals.push({
      id: 'p-1',
      auth_user_id: user.id,
      email: 'owner@octo.dev',
      display_name: 'Platform Owner',
      avatar_url: null,
      is_platform_owner: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    db.workspaces.push({
      id: 'ws-1',
      slug: 'personal',
      name: 'Personal',
      description: 'Owner private workspace',
      created_by: 'p-1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    db.memberships.push({
      id: 'mem-1',
      workspace_id: 'ws-1',
      principal_id: 'p-1',
      role: 'owner',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const client = createMockSupabaseClient(db, user);

    // Owner satisfies all minimum roles
    expect(await hasMinimumRole(client, 'ws-1', 'member')).toBe(true);
    expect(await hasMinimumRole(client, 'ws-1', 'operator')).toBe(true);
    expect(await hasMinimumRole(client, 'ws-1', 'admin')).toBe(true);
    expect(await hasMinimumRole(client, 'ws-1', 'owner')).toBe(true);
  });
});

describe('Session Lifecycle & Google Sign-In', () => {
  it('creates stable principal on first Google login', async () => {
    const db = new MockDatabase();
    const user: User = {
      id: 'google-sub-12345',
      email: 'alex@example.com',
      app_metadata: {},
      user_metadata: {
        full_name: 'Alex Rivera',
        avatar_url: 'https://lh3.googleusercontent.com/a/mock',
      },
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    };

    const client = createMockSupabaseClient(db, user);

    // First login: creates principal row
    const principal = await resolveCurrentPrincipal(client);
    expect(principal).not.toBeNull();
    expect(principal?.authUserId).toBe('google-sub-12345');
    expect(principal?.email).toBe('alex@example.com');
    expect(principal?.displayName).toBe('Alex Rivera');
    expect(principal?.isPlatformOwner).toBe(false);

    // Second call: resolves existing principal without creating duplicate
    const secondCall = await resolveCurrentPrincipal(client);
    expect(secondCall?.id).toBe(principal?.id);
    expect(db.principals.length).toBe(1);
  });

  it('fails closed when unauthenticated user attempts to resolve principal', async () => {
    const db = new MockDatabase();
    const unauthenticatedClient = createMockSupabaseClient(db, null);

    const principal = await resolveCurrentPrincipal(unauthenticatedClient);
    expect(principal).toBeNull();
  });

  it('constructs Google OAuth sign-in URL with proper redirect', async () => {
    const db = new MockDatabase();
    const client = createMockSupabaseClient(db, null);

    const { url, error } = await signInWithGoogle(client, 'http://localhost:3000/auth/callback');
    expect(error).toBeUndefined();
    expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fcallback');
  });

  it('signs out cleanly without error', async () => {
    const db = new MockDatabase();
    const client = createMockSupabaseClient(db, null);

    const { error } = await signOut(client);
    expect(error).toBeUndefined();
  });
});
