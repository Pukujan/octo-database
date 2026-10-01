/**
 * Integration Tests: Workspace Gallery (Slice 3)
 *
 * Verifies:
 * 1. Gallery queries image and video media files from workspace
 * 2. Non-media files (PDF, text) are excluded from gallery view
 * 3. Media kinds (image vs video) are derived properly
 * 4. Cross-workspace isolation (unauthorized user receives 403 Forbidden)
 */

import { describe, expect, it } from 'vitest';
import { User } from '@supabase/supabase-js';
import { getWorkspaceGallery } from '../../src/media/gallery-service';
import { createMockSupabaseClient, MockDatabase } from '../mocks/mock-supabase';
import { MockR2StorageProvider } from '../mocks/mock-r2';
import { R2StorageProvider } from '../../src/storage/r2-client';

describe('Slice 3 Integration: Workspace Gallery', () => {
  it('fetches gallery media with thumbnails and enforces cross-workspace privacy', async () => {
    const db = new MockDatabase();
    const r2Mock = new MockR2StorageProvider();
    const r2 = r2Mock as unknown as R2StorageProvider;

    const user: User = {
      id: 'sub-gallery-owner',
      email: 'owner@gallery.dev',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    };

    db.principals.push({
      id: 'p-gal',
      auth_user_id: user.id,
      email: user.email!,
      display_name: 'Gallery Owner',
      avatar_url: null,
      is_platform_owner: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const wsId = 'ws-gallery-1';
    db.workspaces.push({
      id: wsId,
      slug: 'family-gallery',
      name: 'Family Gallery',
      description: 'Private family media album',
      created_by: 'p-gal',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    db.memberships.push({
      id: 'mem-gal',
      workspace_id: wsId,
      principal_id: 'p-gal',
      role: 'owner',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Seed files: 1 image, 1 video, 1 PDF document
    db.files.push(
      {
        id: 'f-img-1',
        workspace_id: wsId,
        created_by: 'p-gal',
        name: 'vacation.png',
        mime_type: 'image/png',
        size_bytes: 204800,
        provider: 'r2',
        storage_key: `workspaces/${wsId}/f-img-1/vacation.png`,
        status: 'active',
        content_hash: 'hash-img',
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'f-vid-1',
        workspace_id: wsId,
        created_by: 'p-gal',
        name: 'birthday.mp4',
        mime_type: 'video/mp4',
        size_bytes: 5242880,
        provider: 'r2',
        storage_key: `workspaces/${wsId}/f-vid-1/birthday.mp4`,
        status: 'active',
        content_hash: 'hash-vid',
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'f-doc-1',
        workspace_id: wsId,
        created_by: 'p-gal',
        name: 'taxes.pdf',
        mime_type: 'application/pdf',
        size_bytes: 40960,
        provider: 'r2',
        storage_key: `workspaces/${wsId}/f-doc-1/taxes.pdf`,
        status: 'active',
        content_hash: 'hash-doc',
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    );

    const client = createMockSupabaseClient(db, user);
    const principal = {
      id: 'p-gal',
      authUserId: user.id,
      email: user.email!,
      displayName: 'Gallery Owner',
      avatarUrl: null,
      isPlatformOwner: false,
      isGuest: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // --- 1. Fetch gallery items ---
    const galleryItems = await getWorkspaceGallery(client, r2, principal, wsId);

    // Must return exactly 2 media items (taxes.pdf must be excluded)
    expect(galleryItems.length).toBe(2);

    const imageItem = galleryItems.find((i) => i.name === 'vacation.png');
    expect(imageItem).toBeDefined();
    expect(imageItem?.kind).toBe('image');
    // Grid must use the derivative route, never the full original.
    expect(imageItem?.thumbnailUrl).toContain('/api/files/thumbnail');
    expect(imageItem?.thumbnailUrl).not.toBe(imageItem?.fullUrl);

    const videoItem = galleryItems.find((i) => i.name === 'birthday.mp4');
    expect(videoItem).toBeDefined();
    expect(videoItem?.kind).toBe('video');

    // --- 2. Cross-workspace isolation check ---
    const outsiderUser: User = {
      id: 'sub-outsider',
      email: 'outsider@other.com',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    };
    db.principals.push({
      id: 'p-outsider',
      auth_user_id: outsiderUser.id,
      email: outsiderUser.email!,
      display_name: 'Outsider',
      avatar_url: null,
      is_platform_owner: false,
      is_guest: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const outsiderClient = createMockSupabaseClient(db, outsiderUser);
    const outsiderPrincipal = {
      id: 'p-outsider',
      authUserId: outsiderUser.id,
      email: outsiderUser.email!,
      displayName: 'Outsider',
      avatarUrl: null,
      isPlatformOwner: false,
      isGuest: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Outsider cannot access victim workspace gallery
    await expect(
      getWorkspaceGallery(outsiderClient, r2, outsiderPrincipal, wsId)
    ).rejects.toThrow(/FORBIDDEN: Access denied/);
  });
});
