/**
 * Workspace Gallery Service (Slice 3)
 *
 * Provides visual album browsing, thumbnail resolution, and full-resolution media URLs.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { Principal } from '../types/auth';
import { evaluateWorkspaceAccess } from '../auth/authorization';
import { R2StorageProvider } from '../storage/r2-client';
import { getMediaKind, isImage, isVideo, MediaKind } from './classifier';

export interface GalleryItem {
  id: string;
  workspaceId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: MediaKind;
  storageKey: string;
  thumbnailUrl: string;
  fullUrl: string;
  createdAt: string;
}

/**
 * Lists image and video items for an authorized workspace gallery.
 * Fails closed if the caller lacks workspace access.
 */
export async function getWorkspaceGallery(
  supabase: SupabaseClient,
  r2: R2StorageProvider | null,
  principal: Principal,
  workspaceId: string
): Promise<GalleryItem[]> {
  const access = await evaluateWorkspaceAccess(supabase, workspaceId);

  if (!access.allowed) {
    throw new Error(`FORBIDDEN: Access denied to workspace ${workspaceId}`);
  }

  const { data: files, error } = await supabase
    .schema('octo')
    .from('files')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (error || !files) {
    throw new Error(`GALLERY_FETCH_FAILED: ${error?.message ?? 'Unknown error'}`);
  }

  const mediaFiles = files.filter(
    (f: { mime_type: string }) => isImage(f.mime_type) || isVideo(f.mime_type)
  );

  const items: GalleryItem[] = [];

  for (const f of mediaFiles) {
    const kind = getMediaKind(f.mime_type);
    const fullUrl = r2
      ? await r2.generatePresignedDownloadUrl(f.storage_key, 3600)
      : `/api/files/content?fileId=${f.id}&workspaceId=${workspaceId}`;

    // Grid loads the cached derivative; only the full view uses the original.
    const thumbnailUrl = `/api/files/thumbnail?fileId=${f.id}&workspaceId=${workspaceId}`;

    items.push({
      id: f.id,
      workspaceId: f.workspace_id,
      name: f.name,
      mimeType: f.mime_type,
      sizeBytes: Number(f.size_bytes),
      kind,
      storageKey: f.storage_key,
      thumbnailUrl,
      fullUrl,
      createdAt: f.created_at,
    });
  }

  return items;
}
