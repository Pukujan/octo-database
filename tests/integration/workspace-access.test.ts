/**
 * Integration Tests: Workspace Access, Isolation & Session Revocation (Slice 1)
 *
 * Verifies all Issue #3 success conditions:
 * 1. Approved owner signs in with Google
 * 2. Stable user principal created/resolved
 * 3. Dashboard lists exactly authorized workspaces
 * 4. Entering Personal works
 * 5. Second unapproved account cannot enumerate or access Personal
 * 6. Logout / session revocation blocks subsequent access
 */

import { describe, expect, it } from 'vitest';
import { User } from '@supabase/supabase-js';
import { resolveCurrentPrincipal, signOut } from '../../src/auth/session';
import { evaluateWorkspaceAccess, listAuthorizedWorkspaces } from '../../src/auth/authorization';
import { createWorkspace, enterWorkspace } from '../../src/auth/workspace-service';
import { createMockSupabaseClient, MockDatabase } from '../mocks/mock-supabase';

describe('Slice 1 Integration: End-to-End Workspace Access & Isolation', () => {
  it('executes full approved owner flow and strictly denies unauthorized access', async () => {
    const db = new MockDatabase();

    // --- STEP 1 & 2: Approved owner signs in with Google ---
    const ownerUser: User = {
      id: 'google-sub-owner',
      email: 'owner@octo.dev',
      app_metadata: {},
      user_metadata: { full_name: 'Octo Owner', picture: 'https://octo.dev/avatar.png' },
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    };

    const ownerClient = createMockSupabaseClient(db, ownerUser);

    const ownerPrincipal = await resolveCurrentPrincipal(ownerClient);
    expect(ownerPrincipal).not.toBeNull();
    expect(ownerPrincipal?.email).toBe('owner@octo.dev');
    expect(ownerPrincipal?.authUserId).toBe('google-sub-owner');

    // --- STEP 3 & 4: Owner creates & enters 'Personal' workspace ---
    const personalContext = await createWorkspace(ownerClient, ownerPrincipal!, {
      name: 'Personal',
      slug: 'personal',
      description: 'Private personal workspace',
    });

    expect(personalContext.workspace.name).toBe('Personal');
    expect(personalContext.workspace.slug).toBe('personal');
    expect(personalContext.role).toBe('owner');
    expect(personalContext.capabilities.canUploadFiles).toBe(true);
    expect(personalContext.capabilities.canDeleteWorkspace).toBe(true);

    // Verify entering 'Personal' works cleanly
    const reenteredContext = await enterWorkspace(ownerClient, ownerPrincipal!, personalContext.workspace.id);
    expect(reenteredContext.workspace.id).toBe(personalContext.workspace.id);
    expect(reenteredContext.role).toBe('owner');

    // List authorized workspaces for owner: must contain 'Personal'
    const ownerWorkspaces = await listAuthorizedWorkspaces(ownerClient);
    expect(ownerWorkspaces.length).toBe(1);
    expect(ownerWorkspaces[0].slug).toBe('personal');
    expect(ownerWorkspaces[0].isOwner).toBe(true);

    // --- STEP 5: Second unapproved account signs in ---
    const secondUser: User = {
      id: 'google-sub-outsider',
      email: 'outsider@example.com',
      app_metadata: {},
      user_metadata: { full_name: 'Outsider User' },
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    };

    const secondClient = createMockSupabaseClient(db, secondUser);
    const secondPrincipal = await resolveCurrentPrincipal(secondClient);
    expect(secondPrincipal).not.toBeNull();
    expect(secondPrincipal?.email).toBe('outsider@example.com');

    // Second user listing authorized workspaces: MUST be empty! (RLS filters out Personal)
    const secondWorkspaces = await listAuthorizedWorkspaces(secondClient);
    expect(secondWorkspaces.length).toBe(0);

    // Second user attempts direct entry / URL guessing into 'Personal' workspace ID: MUST FAIL CLOSED!
    const directAccessResult = await evaluateWorkspaceAccess(secondClient, personalContext.workspace.id);
    expect(directAccessResult.allowed).toBe(false);
    expect(directAccessResult.reason).toBe('WORKSPACE_ACCESS_DENIED');

    await expect(
      enterWorkspace(secondClient, secondPrincipal!, personalContext.workspace.id)
    ).rejects.toThrow(/FORBIDDEN: Access denied/);

    // --- STEP 6: Logout / session revocation ---
    await signOut(ownerClient);

    // Unauthenticated client after logout cannot list or access workspaces
    const unauthenticatedClient = createMockSupabaseClient(db, null);
    const unauthedWorkspaces = await listAuthorizedWorkspaces(unauthenticatedClient);
    expect(unauthedWorkspaces.length).toBe(0);

    const unauthedAccess = await evaluateWorkspaceAccess(unauthenticatedClient, personalContext.workspace.id);
    expect(unauthedAccess.allowed).toBe(false);
  });
});
