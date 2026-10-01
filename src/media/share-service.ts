/**
 * Scoped Share Links (Slice 4)
 *
 * Creates read-only share links that expose exactly one target resource to anyone
 * holding the token. The raw token is returned once and never stored; only its
 * SHA-256 hash is persisted, so a database read cannot reconstruct a live link.
 */

import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { Principal } from '../types/auth';

export type SharePermission = 'read' | 'upload';
export type ShareResourceType = 'gallery' | 'album' | 'folder';

export interface ShareRecord {
  id: string;
  workspaceId: string;
  resourceType: ShareResourceType;
  resourceId: string | null;
  tokenPrefix: string;
  permission: SharePermission;
  validFrom: string;
  validUntil: string | null;
  revokedAt: string | null;
  createdBy: string;
  createdAt: string;
  lastAccessedAt: string | null;
  accessCount: number;
}

export interface ResolvedShare {
  shareId: string;
  workspaceId: string;
  resourceType: ShareResourceType;
  resourceId: string | null;
  permission: SharePermission;
  validUntil: string | null;
}

export interface CreateShareInput {
  workspaceId: string;
  resourceType?: ShareResourceType;
  resourceId?: string | null;
  permission?: SharePermission;
  /** Absolute expiry. Omit for a non-expiring link that can still be revoked. */
  validUntil?: string | null;
  /** Relative expiry in hours; ignored when validUntil is supplied. */
  expiresInHours?: number;
}

export interface CreatedShare {
  share: ShareRecord;
  /** Returned exactly once; never persisted and never logged. */
  rawToken: string;
}

/** SHA-256 of a raw share token. Only this value is stored. */
export function hashShareToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/** Constant-time comparison of two token hashes. */
export function shareHashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Creates a share link. `read` is the only default; `upload` must be requested
 * explicitly so editable sharing can never be enabled by omission.
 */
export async function createShare(
  supabase: SupabaseClient,
  principal: Principal,
  input: CreateShareInput
): Promise<CreatedShare> {
  const rawToken = `octo_share_${randomBytes(32).toString('base64url')}`;
  const tokenHash = hashShareToken(rawToken);
  const tokenPrefix = rawToken.slice(0, 18);

  let validUntil: string | null = input.validUntil ?? null;
  if (!validUntil && input.expiresInHours && input.expiresInHours > 0) {
    const expiry = new Date();
    expiry.setHours(expiry.getHours() + input.expiresInHours);
    validUntil = expiry.toISOString();
  }

  const row = {
    workspace_id: input.workspaceId,
    resource_type: input.resourceType ?? 'gallery',
    resource_id: input.resourceId ?? null,
    token_hash: tokenHash,
    token_prefix: tokenPrefix,
    permission: input.permission ?? 'read',
    valid_until: validUntil,
    created_by: principal.id,
  };

  const { data, error } = await supabase
    .schema('octo')
    .from('shares')
    .insert(row)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`SHARE_CREATE_FAILED: ${error?.message ?? 'Unknown error'}`);
  }

  return { share: mapShareRow(data), rawToken };
}

/**
 * Resolves a raw token to an active share.
 * Fails closed when the share is unknown, revoked, not yet valid, or expired.
 */
export async function resolveShare(
  supabase: SupabaseClient,
  rawToken: string
): Promise<ResolvedShare | null> {
  if (!rawToken || !rawToken.startsWith('octo_share_')) return null;

  const tokenHash = hashShareToken(rawToken);

  const { data, error } = await supabase
    .schema('octo')
    .rpc('resolve_share', { target_hash: tokenHash });

  if (error || !data) return null;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;

  return {
    shareId: row.share_id,
    workspaceId: row.workspace_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    permission: row.permission,
    validUntil: row.valid_until,
  };
}

/** Lists a workspace's shares. Tokens and hashes are never returned. */
export async function listShares(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<ShareRecord[]> {
  const { data, error } = await supabase
    .schema('octo')
    .from('shares')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`SHARE_LIST_FAILED: ${error.message}`);
  if (!data) return [];
  return data.map(mapShareRow);
}

/** Revokes a share. Subsequent authorization for its token fails immediately. */
export async function revokeShare(
  supabase: SupabaseClient,
  shareId: string
): Promise<void> {
  const { error } = await supabase
    .schema('octo')
    .from('shares')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', shareId);

  if (error) throw new Error(`SHARE_REVOKE_FAILED: ${error.message}`);
}

/** True when the share is currently usable, evaluated against the given instant. */
export function isShareActive(share: ShareRecord, at: Date = new Date()): boolean {
  if (share.revokedAt) return false;
  if (new Date(share.validFrom).getTime() > at.getTime()) return false;
  if (share.validUntil && new Date(share.validUntil).getTime() <= at.getTime()) return false;
  return true;
}

/** Redacts a token for audit output: prefix plus a fixed marker, never the secret. */
export function redactShareToken(rawToken: string): string {
  if (!rawToken.startsWith('octo_share_')) return '[redacted]';
  return `${rawToken.slice(0, 18)}...[redacted]`;
}

interface RawShareRow {
  id: string;
  workspace_id: string;
  resource_type: ShareResourceType;
  resource_id: string | null;
  token_prefix: string;
  permission: SharePermission;
  valid_from: string;
  valid_until: string | null;
  revoked_at: string | null;
  created_by: string;
  created_at: string;
  last_accessed_at: string | null;
  access_count: number | string;
}

function mapShareRow(row: unknown): ShareRecord {
  const r = row as RawShareRow;
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    resourceType: r.resource_type,
    resourceId: r.resource_id,
    tokenPrefix: r.token_prefix,
    permission: r.permission,
    validFrom: r.valid_from,
    validUntil: r.valid_until,
    revokedAt: r.revoked_at,
    createdBy: r.created_by,
    createdAt: r.created_at,
    lastAccessedAt: r.last_accessed_at,
    accessCount: Number(r.access_count ?? 0),
  };
}

/** Share metadata safe to show in the dashboard: never includes the token or hash. */
export interface ShareSummary {
  id: string;
  resourceType: ShareResourceType;
  permission: SharePermission;
  validUntil: string | null;
  revokedAt: string | null;
  createdAt: string;
  accessCount: number;
  lastAccessedAt: string | null;
  active: boolean;
}
