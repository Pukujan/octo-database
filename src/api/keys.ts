/**
 * Octo API Key Engine (Slice 7 / Issue #9)
 *
 * Manages account-wide and workspace-scoped machine identities.
 * Stores cryptographically secure SHA-256 hashes; secrets are never stored in plaintext.
 */

import { createHash, randomBytes } from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { Principal, WorkspaceRole } from '../types/auth';

export interface ApiKey {
  id: string;
  prefix: string;
  name: string;
  principalId: string;
  workspaceId: string | null; // null = Account-wide
  role: WorkspaceRole | null;
  scopes: string[];
  expiresAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  isAccountWide: boolean;
}

export interface CreateApiKeyInput {
  name: string;
  workspaceId?: string | null; // Omit or null for account-wide key
  role?: WorkspaceRole;
  scopes?: string[];
  expiresInDays?: number;
}

export interface CreatedApiKeyResult {
  apiKey: ApiKey;
  rawSecret: string;
}

export interface VerifiedApiKey {
  apiKey: ApiKey;
  principal: Principal;
  isAccountWide: boolean;
  workspaceId: string | null;
}

/**
 * Computes a SHA-256 hash of a raw API key secret.
 */
export function hashApiKeySecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * Creates a new API key (either account-wide or workspace-scoped).
 * Returns the raw secret exactly once.
 */
export async function createApiKey(
  supabase: SupabaseClient,
  principal: Principal,
  input: CreateApiKeyInput
): Promise<CreatedApiKeyResult> {
  const isAccountWide = !input.workspaceId;
  const prefix = isAccountWide ? 'octo_live_acc' : 'octo_live_ws';
  const secretBytes = randomBytes(24).toString('hex');
  const rawSecret = `${prefix}_${secretBytes}`;
  const keyHash = hashApiKeySecret(rawSecret);

  let expiresAt: string | null = null;
  if (input.expiresInDays && input.expiresInDays > 0) {
    const d = new Date();
    d.setDate(d.getDate() + input.expiresInDays);
    expiresAt = d.toISOString();
  }

  const scopes = input.scopes ?? ['read', 'write'];
  const now = new Date().toISOString();

  const row = {
    key_hash: keyHash,
    prefix,
    name: input.name.trim(),
    principal_id: principal.id,
    workspace_id: input.workspaceId ?? null,
    role: input.role ?? (isAccountWide ? 'owner' : 'member'),
    scopes,
    expires_at: expiresAt,
    created_at: now,
  };

  const { data: inserted, error } = await supabase
    .schema('octo')
    .from('api_keys')
    .insert(row)
    .select('*')
    .single();

  if (error || !inserted) {
    throw new Error(`API_KEY_CREATE_FAILED: ${error?.message ?? 'Unknown error'}`);
  }

  const apiKey = mapApiKeyRow(inserted);

  return {
    apiKey,
    rawSecret,
  };
}

/**
 * Verifies a bearer API key against octo.api_keys:
 * 1. Checks key format and prefix.
 * 2. Hashes secret with SHA-256.
 * 3. Resolves key record from database.
 * 4. Verifies expiration.
 * 5. Updates last_used_at.
 * 6. Resolves parent principal.
 * Fails closed if invalid, revoked, or expired.
 */
export async function verifyApiKey(
  supabase: SupabaseClient,
  rawSecret: string
): Promise<VerifiedApiKey | null> {
  if (!rawSecret || (!rawSecret.startsWith('octo_live_acc_') && !rawSecret.startsWith('octo_live_ws_'))) {
    return null;
  }

  const keyHash = hashApiKeySecret(rawSecret);

  // 1. Call SECURITY DEFINER RPC to verify key and update last_used_at atomically
  let keyRow: RawApiKeyRow | null = null;
  const { data: rpcData, error: rpcError } = await supabase
    .schema('octo')
    .rpc('verify_api_key', { target_hash: keyHash });

  if (!rpcError && rpcData) {
    keyRow = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  } else {
    // Fallback for mocks / environments where RPC is direct
    const { data: directData } = await supabase
      .schema('octo')
      .from('api_keys')
      .select('*')
      .eq('key_hash', keyHash)
      .maybeSingle();
    keyRow = directData;
  }

  if (!keyRow) {
    return null;
  }

  // Check expiration if evaluated client-side
  if (keyRow.expires_at) {
    const expiryTime = new Date(keyRow.expires_at).getTime();
    if (Date.now() >= expiryTime) {
      return null;
    }
  }

  // 2. Resolve parent principal via SECURITY DEFINER RPC
  let principalRow: RawPrincipalRow | null = null;
  const { data: pRpcData } = await supabase
    .schema('octo')
    .rpc('resolve_principal_by_id', { target_id: keyRow.principal_id });

  if (pRpcData) {
    principalRow = Array.isArray(pRpcData) ? pRpcData[0] : pRpcData;
  } else {
    const { data: directPrincipal } = await supabase
      .schema('octo')
      .from('principals')
      .select('*')
      .eq('id', keyRow.principal_id)
      .maybeSingle();
    principalRow = directPrincipal;
  }

  if (!principalRow) {
    return null;
  }

  const principal: Principal = {
    id: principalRow.id,
    authUserId: principalRow.auth_user_id,
    email: principalRow.email,
    displayName: principalRow.display_name,
    avatarUrl: principalRow.avatar_url,
    isPlatformOwner: principalRow.is_platform_owner,
    isGuest: Boolean(principalRow.is_guest),
    createdAt: principalRow.created_at,
    updatedAt: principalRow.updated_at,
  };

  const apiKey = mapApiKeyRow(keyRow);

  return {
    apiKey,
    principal,
    isAccountWide: apiKey.isAccountWide,
    workspaceId: apiKey.workspaceId,
  };
}

/**
 * Lists all API keys belonging to the current authenticated user.
 */
export async function listApiKeys(supabase: SupabaseClient): Promise<ApiKey[]> {
  const { data, error } = await supabase
    .schema('octo')
    .from('api_keys')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`LIST_API_KEYS_FAILED: ${error.message}`);
  }

  if (!data) return [];
  return data.map(mapApiKeyRow);
}

/**
 * Revokes (deletes) an API key.
 */
export async function revokeApiKey(
  supabase: SupabaseClient,
  apiKeyId: string
): Promise<void> {
  const { error } = await supabase
    .schema('octo')
    .from('api_keys')
    .delete()
    .eq('id', apiKeyId);

  if (error) {
    throw new Error(`REVOKE_API_KEY_FAILED: ${error.message}`);
  }
}

interface RawApiKeyRow {
  id: string;
  prefix: string;
  name: string;
  principal_id: string;
  workspace_id: string | null;
  role: WorkspaceRole | null;
  scopes: string[];
  expires_at: string | null;
  created_at: string;
  last_used_at: string | null;
}

interface RawPrincipalRow {
  id: string;
  auth_user_id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  is_platform_owner: boolean;
  is_guest?: boolean;
  created_at: string;
  updated_at: string;
}

function mapApiKeyRow(row: unknown): ApiKey {
  const r = row as RawApiKeyRow;
  return {
    id: r.id,
    prefix: r.prefix,
    name: r.name,
    principalId: r.principal_id,
    workspaceId: r.workspace_id,
    role: r.role,
    scopes: r.scopes ?? ['read', 'write'],
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    isAccountWide: r.workspace_id === null,
  };
}
