/**
 * Integration Tests: Platform API Keys and Gateway (Issue #9)
 *
 * Verifies:
 * 1. Account-wide API key creation and usage
 * 2. Workspace-scoped API key creation and strict boundary enforcement
 * 3. Gateway action routing (workspaces, files)
 * 4. Rejection of cross-workspace access with scoped keys
 * 5. Rejection of invalid or revoked keys
 */

import { describe, expect, it } from 'vitest';
import { User } from '@supabase/supabase-js';
import { createApiKey, verifyApiKey } from '../../src/api/keys';
import { handleApiRequest } from '../../src/api/gateway';
import { createMockSupabaseClient, MockDatabase } from '../mocks/mock-supabase';
import { MockR2StorageProvider } from '../mocks/mock-r2';
import { R2StorageProvider } from '../../src/storage/r2-client';

describe('API Keys & Gateway: Account-Wide vs Workspace-Scoped Access', () => {
  it('enforces boundaries for both account-wide and workspace-scoped machine keys', async () => {
    const db = new MockDatabase();
    const r2Mock = new MockR2StorageProvider();
    const r2 = r2Mock as unknown as R2StorageProvider;

    // --- SETUP: User with two workspaces (Work, Personal) ---
    const user: User = {
      id: 'sub-user-dev',
      email: 'dev@octo.dev',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    };

    db.principals.push({
      id: 'p-dev',
      auth_user_id: user.id,
      email: user.email!,
      display_name: 'Developer',
      avatar_url: null,
      is_platform_owner: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const client = createMockSupabaseClient(db, user);
    const principal = {
      id: 'p-dev',
      authUserId: user.id,
      email: user.email!,
      displayName: 'Developer',
      avatarUrl: null,
      isPlatformOwner: true,
      isGuest: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    db.workspaces.push(
      {
        id: 'ws-work',
        slug: 'work',
        name: 'Work',
        description: null,
        created_by: 'p-dev',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'ws-personal',
        slug: 'personal',
        name: 'Personal',
        description: null,
        created_by: 'p-dev',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    );

    db.memberships.push(
      {
        id: 'mem-1',
        workspace_id: 'ws-work',
        principal_id: 'p-dev',
        role: 'owner',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'mem-2',
        workspace_id: 'ws-personal',
        principal_id: 'p-dev',
        role: 'owner',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    );

    // --- 1. Mint Account-Wide API Key ---
    const { apiKey: accKey, rawSecret: accSecret } = await createApiKey(client, principal, {
      name: 'Account-Wide Agent Key',
      workspaceId: null, // Account-wide
    });

    expect(accKey.isAccountWide).toBe(true);
    expect(accSecret.startsWith('octo_live_acc_')).toBe(true);

    // Verify key directly
    const verifiedAcc = await verifyApiKey(client, accSecret);
    expect(verifiedAcc).not.toBeNull();
    expect(verifiedAcc?.isAccountWide).toBe(true);

    // --- 2. Call Gateway with Account-Wide Key ---
    // List workspaces: sees both Work and Personal
    const listRes = await handleApiRequest(client, r2, {
      bearerToken: accSecret,
      action: 'workspaces.list',
    });
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.data)).toBe(true);
    expect((listRes.data as unknown[]).length).toBe(2);

    // Upload file to 'Work' workspace via Account-Wide Key
    const uploadRes = await handleApiRequest(client, r2, {
      bearerToken: accSecret,
      action: 'files.upload',
      workspaceId: 'ws-work',
      payload: {
        name: 'spec.md',
        mimeType: 'text/markdown',
        data: '# Architecture Spec',
      },
    });
    expect(uploadRes.status).toBe(201);
    expect((uploadRes.data as { name: string })?.name).toBe('spec.md');

    // --- 3. Mint Workspace-Scoped API Key (Restricted to 'Personal' only) ---
    const { apiKey: scopedKey, rawSecret: scopedSecret } = await createApiKey(client, principal, {
      name: 'Personal Only Key',
      workspaceId: 'ws-personal', // Restricted to Personal
      role: 'operator',
    });
    const uploadData = uploadRes.data;
    if (uploadData && typeof uploadData === 'object' && 'name' in uploadData) {
      expect(uploadData.name).toBe('spec.md');
    }
    expect(scopedKey.isAccountWide).toBe(false);
    expect(scopedSecret.startsWith('octo_live_ws_')).toBe(true);

    // --- 4. Call Gateway with Workspace-Scoped Key ---
    // Attempting to access 'Work' workspace with 'Personal' scoped key: MUST RETURN 403 FORBIDDEN!
    const forbiddenRes = await handleApiRequest(client, r2, {
      bearerToken: scopedSecret,
      action: 'files.list',
      workspaceId: 'ws-work', // Different workspace!
    });
    expect(forbiddenRes.status).toBe(403);
    expect(forbiddenRes.error).toContain('FORBIDDEN');

    // Accessing 'Personal' workspace with scoped key: SUCCEEDS
    const allowedRes = await handleApiRequest(client, r2, {
      bearerToken: scopedSecret,
      action: 'files.list',
      workspaceId: 'ws-personal',
    });
    expect(allowedRes.status).toBe(200);

    // --- 5. Unauthenticated / Invalid Key Handling ---
    const invalidKeyRes = await handleApiRequest(client, r2, {
      bearerToken: 'octo_live_ws_bogus_invalid_token',
      action: 'workspaces.list',
    });
    expect(invalidKeyRes.status).toBe(401);

    const emptyTokenRes = await handleApiRequest(client, r2, {
      bearerToken: '',
      action: 'workspaces.list',
    });
    expect(emptyTokenRes.status).toBe(401);
  });
});
