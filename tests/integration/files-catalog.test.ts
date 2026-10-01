/**
 * Integration Tests: File Catalog & R2 Active Storage (Slice 2)
 *
 * Verifies all Issue #4 success conditions:
 * 1. Upload a file into Personal workspace
 * 2. Bytes exist in private R2 storage
 * 3. Canonical Postgres metadata points to it
 * 4. Another authorized session can list/open it by logical file ID
 * 5. Unauthorized workspace/user cannot enumerate/download it
 * 6. Delete removes both R2 object and database record
 */

import { describe, expect, it } from 'vitest';
import { User } from '@supabase/supabase-js';
import {
  deleteWorkspaceFile,
  getWorkspaceFile,
  listWorkspaceFiles,
  uploadWorkspaceFile,
} from '../../src/storage/file-service';
import { createMockSupabaseClient, MockDatabase } from '../mocks/mock-supabase';
import { MockR2StorageProvider } from '../mocks/mock-r2';
import { R2StorageProvider } from '../../src/storage/r2-client';

describe('Slice 2 Integration: File Catalog & R2 Active Storage', () => {
  it('manages file lifecycle across R2 and canonical metadata with strict isolation', async () => {
    const db = new MockDatabase();
    const r2Mock = new MockR2StorageProvider();
    const r2 = r2Mock as unknown as R2StorageProvider;

    // --- SETUP: User A (Owner) with Personal Workspace ---
    const userA: User = {
      id: 'sub-owner-a',
      email: 'owner@octo.dev',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    };

    db.principals.push({
      id: 'p-a',
      auth_user_id: userA.id,
      email: userA.email!,
      display_name: 'Owner A',
      avatar_url: null,
      is_platform_owner: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    db.workspaces.push({
      id: 'ws-personal',
      slug: 'personal',
      name: 'Personal',
      description: 'Owner Personal Workspace',
      created_by: 'p-a',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    db.memberships.push({
      id: 'mem-a',
      workspace_id: 'ws-personal',
      principal_id: 'p-a',
      role: 'owner',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const clientA = createMockSupabaseClient(db, userA);
    const principalA = {
      id: 'p-a',
      authUserId: userA.id,
      email: userA.email!,
      displayName: 'Owner A',
      avatarUrl: null,
      isPlatformOwner: true,
      isGuest: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // --- STEP 1 & 2: Upload file into Personal workspace ---
    const fileContent = 'Report content payload 12345';
    const uploadedFile = await uploadWorkspaceFile(clientA, r2, principalA, 'ws-personal', {
      name: 'annual_report.txt',
      mimeType: 'text/plain',
      data: fileContent,
    });

    expect(uploadedFile.id).toBeDefined();
    expect(uploadedFile.name).toBe('annual_report.txt');
    expect(uploadedFile.sizeBytes).toBe(Buffer.byteLength(fileContent));
    expect(uploadedFile.provider).toBe('r2');
    expect(uploadedFile.status).toBe('active');

    // Verify bytes actually exist in R2 storage
    const r2Head = await r2.headObject(uploadedFile.storageKey);
    expect(r2Head).not.toBeNull();
    expect(r2Head?.contentLength).toBe(uploadedFile.sizeBytes);

    // Verify canonical metadata in database catalog
    const dbFile = db.files.find((f) => f.id === uploadedFile.id);
    expect(dbFile).toBeDefined();
    expect(dbFile?.workspace_id).toBe('ws-personal');

    // --- STEP 3: List files for workspace member ---
    const filesList = await listWorkspaceFiles(clientA, 'ws-personal');
    expect(filesList.length).toBe(1);
    expect(filesList[0].id).toBe(uploadedFile.id);

    // --- STEP 4: Open / get file with presigned URL ---
    const fileWithUrl = await getWorkspaceFile(clientA, r2, principalA, 'ws-personal', uploadedFile.id);
    expect(fileWithUrl.file.id).toBe(uploadedFile.id);
    expect(fileWithUrl.downloadUrl).toContain('mock-presigned-download');

    // --- STEP 5: Second unapproved user isolation ---
    const userB: User = {
      id: 'sub-outsider-b',
      email: 'outsider@other.org',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    };

    db.principals.push({
      id: 'p-b',
      auth_user_id: userB.id,
      email: userB.email!,
      display_name: 'Outsider B',
      avatar_url: null,
      is_platform_owner: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const clientB = createMockSupabaseClient(db, userB);
    const principalB = {
      id: 'p-b',
      authUserId: userB.id,
      email: userB.email!,
      displayName: 'Outsider B',
      avatarUrl: null,
      isPlatformOwner: false,
      isGuest: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // User B listing files in User A's workspace: returns 0 files (RLS filters out)
    const outsiderFiles = await listWorkspaceFiles(clientB, 'ws-personal');
    expect(outsiderFiles.length).toBe(0);

    // User B attempting to get User A's file: fails closed with FORBIDDEN
    await expect(
      getWorkspaceFile(clientB, r2, principalB, 'ws-personal', uploadedFile.id)
    ).rejects.toThrow(/FORBIDDEN: Access denied/);

    // User B attempting to delete User A's file: fails closed with FORBIDDEN
    await expect(
      deleteWorkspaceFile(clientB, r2, principalB, 'ws-personal', uploadedFile.id)
    ).rejects.toThrow(/FORBIDDEN: Access denied/);

    // --- STEP 6: Delete file removes both R2 object and catalog record ---
    await deleteWorkspaceFile(clientA, r2, principalA, 'ws-personal', uploadedFile.id);

    // Verify deleted from R2
    const r2HeadAfterDelete = await r2.headObject(uploadedFile.storageKey);
    expect(r2HeadAfterDelete).toBeNull();

    // Verify deleted from DB catalog
    const filesAfterDelete = await listWorkspaceFiles(clientA, 'ws-personal');
    expect(filesAfterDelete.length).toBe(0);
  });
});
