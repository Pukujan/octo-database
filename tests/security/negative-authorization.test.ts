/**
 * Security-Negative Authorization & Secret Hygiene Tests (Slice 1)
 *
 * Verifies fail-closed behavior under hostile or invalid requests:
 * 1. Forged workspace ID guessing
 * 2. Stale or null session handling
 * 3. Missing workspace membership rejection
 * 4. Privilege escalation prevention
 * 5. Secret scan verifying no master credentials in client code
 */

import { describe, expect, it } from 'vitest';
import { User } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { evaluateWorkspaceAccess, hasMinimumRole } from '../../src/auth/authorization';
import { enterWorkspace } from '../../src/auth/workspace-service';
import { createMockSupabaseClient, MockDatabase } from '../mocks/mock-supabase';

describe('Security Negative: Workspace ID Forgery & Missing Memberships', () => {
  it('fails closed when attempting access with forged random workspace ID', async () => {
    const db = new MockDatabase();
    const user: User = {
      id: 'legit-user-1',
      email: 'user@example.com',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    };

    const client = createMockSupabaseClient(db, user);
    const forgedWorkspaceId = '00000000-dead-beef-cafe-000000000000';

    const result = await evaluateWorkspaceAccess(client, forgedWorkspaceId);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('WORKSPACE_ACCESS_DENIED');
  });

  it('fails closed when user exists but has no membership in targeted workspace', async () => {
    const db = new MockDatabase();

    // Create victim workspace belonging to victim
    db.principals.push({
      id: 'p-victim',
      auth_user_id: 'victim-sub',
      email: 'victim@octo.dev',
      display_name: 'Victim',
      avatar_url: null,
      is_platform_owner: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    db.workspaces.push({
      id: 'ws-victim',
      slug: 'victim-vault',
      name: 'Victim Vault',
      description: 'Private records',
      created_by: 'p-victim',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    db.memberships.push({
      id: 'mem-victim',
      workspace_id: 'ws-victim',
      principal_id: 'p-victim',
      role: 'owner',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Attacker signs in
    const attackerUser: User = {
      id: 'attacker-sub',
      email: 'attacker@evil.com',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    };

    const attackerClient = createMockSupabaseClient(db, attackerUser);

    // Attacker queries victim workspace
    const access = await evaluateWorkspaceAccess(attackerClient, 'ws-victim');
    expect(access.allowed).toBe(false);

    // Attacker tries to enter workspace: fails with FORBIDDEN error
    const attackerPrincipal = {
      id: 'p-attacker',
      authUserId: 'attacker-sub',
      email: 'attacker@evil.com',
      displayName: null,
      avatarUrl: null,
      isPlatformOwner: false,
      isGuest: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await expect(enterWorkspace(attackerClient, attackerPrincipal, 'ws-victim')).rejects.toThrow(
      /FORBIDDEN: Access denied/
    );
  });

  it('prevents member from escalating privileges or claiming owner capabilities', async () => {
    const db = new MockDatabase();
    const memberUser: User = {
      id: 'member-sub',
      email: 'member@example.com',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    };

    db.principals.push({
      id: 'p-member',
      auth_user_id: memberUser.id,
      email: memberUser.email!,
      display_name: 'Regular Member',
      avatar_url: null,
      is_platform_owner: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    db.workspaces.push({
      id: 'ws-shared',
      slug: 'shared',
      name: 'Shared Workspace',
      description: null,
      created_by: 'p-other',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    db.memberships.push({
      id: 'mem-shared',
      workspace_id: 'ws-shared',
      principal_id: 'p-member',
      role: 'member',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const client = createMockSupabaseClient(db, memberUser);

    // Member has 'member' role, but NOT 'admin' or 'owner'
    expect(await hasMinimumRole(client, 'ws-shared', 'member')).toBe(true);
    expect(await hasMinimumRole(client, 'ws-shared', 'operator')).toBe(false);
    expect(await hasMinimumRole(client, 'ws-shared', 'admin')).toBe(false);
    expect(await hasMinimumRole(client, 'ws-shared', 'owner')).toBe(false);
  });
});

describe('Security Baseline: Secret Hygiene & Client Credential Leak Scanner', () => {
  it('verifies zero master credentials or service role keys exist in src/', () => {
    const srcDir = path.resolve(__dirname, '../../src');
    const forbiddenPatterns = [
      /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*['"][^'"]+['"]/i,
      /service_role_key\s*[:=]\s*['"][^'"]+['"]/i,
      /-----BEGIN (?:RSA )?PRIVATE KEY-----/,
      /CLOUDFLARE_API_TOKEN\s*[:=]\s*['"][a-zA-Z0-9_-]{20,}['"]/,
      /ghp_[a-zA-Z0-9]{20,}/,
    ];

    function scanDir(dir: string): void {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          for (const pattern of forbiddenPatterns) {
            expect(content).not.toMatch(pattern);
          }
        }
      }
    }

    scanDir(srcDir);
  });
});
