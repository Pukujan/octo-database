/**
 * Logical File Catalog Service (Slice 2)
 *
 * Coordinates database file metadata (octo.files) with Cloudflare R2 active storage.
 */

import { randomUUID } from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { Principal, WorkspaceRole } from '../types/auth';
import { evaluateWorkspaceAccess } from '../auth/authorization';
import { R2StorageProvider } from './r2-client';

export interface FileRecord {
  id: string;
  workspaceId: string;
  createdBy: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  provider: string;
  storageKey: string;
  status: 'pending' | 'active' | 'deleted';
  contentHash: string | null;
  archiveState?: 'active_r2' | 'archiving' | 'archived_drive' | 'restoring' | 'reconciliation_required' | string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UploadFileInput {
  name: string;
  mimeType: string;
  data: Uint8Array | Buffer | string;
  metadata?: Record<string, unknown>;
}

export interface FileWithUrl {
  file: FileRecord;
  downloadUrl: string;
}

/**
 * Uploads a file to a workspace:
 * 1. Checks caller's workspace permissions (owner, admin, or operator).
 * 2. Uploads payload to R2 bucket.
 * 3. Commits metadata to octo.files table.
 * 4. Fails closed with automatic cleanup if database write fails.
 */
export async function uploadWorkspaceFile(
  supabase: SupabaseClient,
  r2: R2StorageProvider,
  principal: Principal,
  workspaceId: string,
  input: UploadFileInput
): Promise<FileRecord> {
  const access = await evaluateWorkspaceAccess(supabase, workspaceId);

  if (!access.allowed || !access.role) {
    throw new Error(`FORBIDDEN: Access denied to workspace ${workspaceId}`);
  }

  const role = access.role;
  const canUpload = role === 'owner' || role === 'admin' || role === 'operator';
  if (!canUpload) {
    throw new Error('FORBIDDEN: Insufficient role to upload files (operator+ required)');
  }

  const fileId = randomUUID();
  const sanitizedName = input.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storageKey = `workspaces/${workspaceId}/${fileId}/${sanitizedName}`;

  // 1. Upload bytes to R2
  const putResult = await r2.putObject(storageKey, input.data, input.mimeType);

  // 2. Commit record to octo.files
  const now = new Date().toISOString();
  const fileRow = {
    id: fileId,
    workspace_id: workspaceId,
    created_by: principal.id,
    name: input.name,
    mime_type: input.mimeType,
    size_bytes: putResult.sizeBytes,
    provider: 'r2',
    storage_key: storageKey,
    status: 'active',
    content_hash: putResult.etag?.replace(/"/g, '') ?? null,
    metadata: input.metadata ?? {},
    created_at: now,
    updated_at: now,
  };

  const { data: inserted, error: dbError } = await supabase
    .schema('octo')
    .from('files')
    .insert(fileRow)
    .select('*')
    .single();

  if (dbError || !inserted) {
    // Cleanup R2 object if DB insertion failed
    try {
      await r2.deleteObject(storageKey);
    } catch {
      // Best effort cleanup
    }
    throw new Error(`FILE_METADATA_INSERT_FAILED: ${dbError?.message ?? 'Unknown error'}`);
  }

  return mapFileRowToRecord(inserted);
}

/**
 * Retrieves a file record and generates a short-lived presigned download URL.
 * Fails closed if the caller lacks workspace membership.
 */
export async function getWorkspaceFile(
  supabase: SupabaseClient,
  r2: R2StorageProvider,
  principal: Principal,
  workspaceId: string,
  fileId: string
): Promise<FileWithUrl> {
  const access = await evaluateWorkspaceAccess(supabase, workspaceId);

  if (!access.allowed) {
    throw new Error(`FORBIDDEN: Access denied to workspace ${workspaceId}`);
  }

  const { data, error } = await supabase
    .schema('octo')
    .from('files')
    .select('*')
    .eq('id', fileId)
    .eq('workspace_id', workspaceId)
    .single();

  if (error || !data) {
    throw new Error(`FILE_NOT_FOUND: File ${fileId} not found in workspace`);
  }

  const file = mapFileRowToRecord(data);
  // An archived file has no R2 object to presign; the content endpoint restores
  // it from the cold tier on demand instead.
  const downloadUrl =
    (data as { archive_state?: string }).archive_state === 'archived_drive'
      ? `/api/files/content?fileId=${fileId}&workspaceId=${workspaceId}`
      : await r2.generatePresignedDownloadUrl(file.storageKey, 3600);

  return { file, downloadUrl };
}

/**
 * Lists all active files in a workspace.
 * RLS enforces that callers only see files in authorized workspaces.
 */
export async function listWorkspaceFiles(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<FileRecord[]> {
  const { data, error } = await supabase
    .schema('octo')
    .from('files')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`LIST_FILES_FAILED: ${error.message}`);
  }

  if (!data) return [];
  return data.map(mapFileRowToRecord);
}

/**
 * Deletes a file from both R2 storage and the database catalog.
 * Requires owner or admin role in the workspace.
 */
export async function deleteWorkspaceFile(
  supabase: SupabaseClient,
  r2: R2StorageProvider,
  principal: Principal,
  workspaceId: string,
  fileId: string
): Promise<void> {
  const access = await evaluateWorkspaceAccess(supabase, workspaceId);

  if (!access.allowed || !access.role) {
    throw new Error(`FORBIDDEN: Access denied to workspace ${workspaceId}`);
  }

  const role = access.role;
  const canDelete = role === 'owner' || role === 'admin';
  if (!canDelete) {
    throw new Error('FORBIDDEN: Only owners and admins can delete files');
  }

  const { data, error: selectError } = await supabase
    .schema('octo')
    .from('files')
    .select('storage_key')
    .eq('id', fileId)
    .eq('workspace_id', workspaceId)
    .single();

  if (selectError || !data) {
    throw new Error(`FILE_NOT_FOUND: File ${fileId} not found`);
  }

  // Delete from R2
  await r2.deleteObject(data.storage_key);

  // Delete from DB catalog
  const { error: deleteError } = await supabase
    .schema('octo')
    .from('files')
    .delete()
    .eq('id', fileId)
    .eq('workspace_id', workspaceId);

  if (deleteError) {
    throw new Error(`FILE_DELETE_FAILED: ${deleteError.message}`);
  }
}

interface RawFileRow {
  id: string;
  workspace_id: string;
  created_by: string;
  name: string;
  mime_type: string;
  size_bytes: number | string;
  provider: string;
  storage_key: string;
  status: 'pending' | 'active' | 'deleted';
  content_hash: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

function mapFileRowToRecord(row: unknown): FileRecord {
  const r = row as RawFileRow;
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    createdBy: r.created_by,
    name: r.name,
    mimeType: r.mime_type,
    sizeBytes: typeof r.size_bytes === 'string' ? parseInt(r.size_bytes, 10) : r.size_bytes,
    provider: r.provider,
    storageKey: r.storage_key,
    status: r.status,
    contentHash: r.content_hash,
    metadata: r.metadata ?? {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
