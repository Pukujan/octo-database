/**
 * Integration Tests: API Keys (Issue #9)
 *
 * The live key model: account-wide (`octo_live_acc_`) vs workspace-scoped
 * (`octo_live_ws_`) machine identities, SHA-256 hashed at rest, verified
 * through octo.verify_api_key. Enforcement of what a key may do lives in the
 * server's requireScope; this covers the key lifecycle itself.
 */

import { describe, expect, it } from 'vitest';
import { User } from '@supabase/supabase-js';
import {
  createApiKey,
  hashApiKeySecret,
  listApiKeys,
  revokeApiKey,
  verifyApiKey,
} from '../../src/api/keys';
import { createMockSupabaseClient, MockDatabase } from '../mocks/mock-supabase';

function seedDeveloper(db: MockDatabase): { user: User; principal: Parameters<typeof createApiKey>[1] } {
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

  return { user, principal };
}

describe('API Keys: account-wide vs workspace-scoped', () => {
  it('mints an account-wide key with the acc prefix and no workspace binding', async () => {
    const db = new MockDatabase();
    const { user, principal } = seedDeveloper(db);
    const client = createMockSupabaseClient(db, user);

    const { apiKey, rawSecret } = await createApiKey(client, principal, {
      name: 'Account-Wide Agent Key',
      workspaceId: null,
    });

    expect(apiKey.isAccountWide).toBe(true);
    expect(apiKey.workspaceId).toBeNull();
    expect(rawSecret.startsWith('octo_live_acc_')).toBe(true);
    // The secret is stored only as a hash.
    expect(db.api_keys[0]!.key_hash).toBe(hashApiKeySecret(rawSecret));
    expect(JSON.stringify(db.api_keys)).not.toContain(rawSecret);

    const verified = await verifyApiKey(client, rawSecret);
    expect(verified).not.toBeNull();
    expect(verified?.isAccountWide).toBe(true);
    expect(verified?.workspaceId).toBeNull();
    expect(verified?.principal.id).toBe('p-dev');
  });

  it('mints a workspace-scoped key pinned to one workspace', async () => {
    const db = new MockDatabase();
    const { user, principal } = seedDeveloper(db);
    const client = createMockSupabaseClient(db, user);

    const { apiKey, rawSecret } = await createApiKey(client, principal, {
      name: 'Personal Only Key',
      workspaceId: 'ws-personal',
      role: 'operator',
      scopes: ['read', 'write', 'files'],
    });

    expect(apiKey.isAccountWide).toBe(false);
    expect(apiKey.workspaceId).toBe('ws-personal');
    expect(rawSecret.startsWith('octo_live_ws_')).toBe(true);
    expect(apiKey.scopes).toEqual(['read', 'write', 'files']);

    const verified = await verifyApiKey(client, rawSecret);
    expect(verified?.isAccountWide).toBe(false);
    expect(verified?.workspaceId).toBe('ws-personal');
  });

  it('fails closed for empty, malformed, and unknown secrets', async () => {
    const db = new MockDatabase();
    const { user } = seedDeveloper(db);
    const client = createMockSupabaseClient(db, user);

    expect(await verifyApiKey(client, '')).toBeNull();
    expect(await verifyApiKey(client, 'not-a-key')).toBeNull();
    expect(await verifyApiKey(client, 'octo_live_ws_bogus_invalid_token')).toBeNull();
    expect(await verifyApiKey(client, 'octo_live_acc_bogus_invalid_token')).toBeNull();
  });

  it('lists and revokes keys', async () => {
    const db = new MockDatabase();
    const { user, principal } = seedDeveloper(db);
    const client = createMockSupabaseClient(db, user);

    await createApiKey(client, principal, { name: 'K1', workspaceId: null });
    await createApiKey(client, principal, { name: 'K2', workspaceId: 'ws-work' });

    const keys = await listApiKeys(client);
    expect(keys.length).toBe(2);

    await revokeApiKey(client, keys[0]!.id);
    const after = await listApiKeys(client);
    expect(after.length).toBe(1);
    expect(after[0]!.id).not.toBe(keys[0]!.id);
  });
});
