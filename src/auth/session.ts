/**
 * Supabase Auth Session and Identity Lifecycle (Slice 1)
 *
 * Wires Google OAuth and user identity to Supabase Auth and octo.principals.
 */

import { SupabaseClient, User } from '@supabase/supabase-js';
import { Principal } from '../types/auth';

export interface AuthState {
  user: User | null;
  principal: Principal | null;
  isAuthenticated: boolean;
}

/**
 * Resolves the currently authenticated Supabase user and their canonical Octo Principal.
 * Fails closed if the session is absent, expired, or unverified.
 */
export async function resolveCurrentPrincipal(
  supabase: SupabaseClient
): Promise<Principal | null> {
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return null;
  }

  const user = authData.user;

  // Query canonical Octo principal record
  const { data: principalData, error: principalError } = await supabase
    .schema('octo')
    .from('principals')
    .select('*')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (principalError) {
    throw new Error(`DATABASE_ERROR: Failed to resolve principal: ${principalError.message}`);
  }

  if (principalData) {
    return {
      id: principalData.id,
      authUserId: principalData.auth_user_id,
      email: principalData.email,
      displayName: principalData.display_name,
      avatarUrl: principalData.avatar_url,
      isPlatformOwner: principalData.is_platform_owner,
      isGuest: Boolean(principalData.is_guest),
      createdAt: principalData.created_at,
      updatedAt: principalData.updated_at,
    };
  }

  // First-time login: create canonical principal from verified Google identity
  const now = new Date().toISOString();
  const email = user.email ?? '';
  const metadata = user.user_metadata ?? {};

  const newPrincipalRecord = {
    auth_user_id: user.id,
    email: email.toLowerCase(),
    display_name: (metadata['full_name'] as string | undefined) ?? (metadata['name'] as string | undefined) ?? null,
    avatar_url: (metadata['avatar_url'] as string | undefined) ?? (metadata['picture'] as string | undefined) ?? null,
    is_platform_owner: false,
    is_guest: false,
    created_at: now,
    updated_at: now,
  };

  const { data: inserted, error: insertError } = await supabase
    .schema('octo')
    .from('principals')
    .insert(newPrincipalRecord)
    .select('*')
    .single();

  if (insertError) {
    throw new Error(`DATABASE_ERROR: Failed to create principal: ${insertError.message}`);
  }

  return {
    id: inserted.id,
    authUserId: inserted.auth_user_id,
    email: inserted.email,
    displayName: inserted.display_name,
    avatarUrl: inserted.avatar_url,
    isPlatformOwner: inserted.is_platform_owner,
    isGuest: Boolean(inserted.is_guest),
    createdAt: inserted.created_at,
    updatedAt: inserted.updated_at,
  };
}

/**
 * Initiates Google OAuth sign-in flow through Supabase Auth.
 */
export async function signInWithGoogle(
  supabase: SupabaseClient,
  redirectTo?: string
): Promise<{ url?: string; error?: Error }> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  });

  if (error) {
    return { error: new Error(error.message) };
  }

  return { url: data.url };
}

/**
 * Revokes current session and signs out.
 */
export async function signOut(supabase: SupabaseClient): Promise<{ error?: Error }> {
  const { error } = await supabase.auth.signOut();
  if (error) {
    return { error: new Error(error.message) };
  }
  return {};
}

/**
 * Authenticates or registers an anonymous Guest user.
 * Creates a guest principal and provisions an initial personal workspace.
 */
export async function loginAsGuest(
  supabase: SupabaseClient,
  displayName = 'Guest User'
): Promise<Principal> {
  // 1. Authenticate anonymously or resolve existing session
  const { data: authData, error: authError } = await supabase.auth.signInAnonymously();
  if (authError || !authData.user) {
    throw new Error(`GUEST_AUTH_FAILED: ${authError?.message ?? 'Failed to authenticate anonymously'}`);
  }

  const user = authData.user;
  const guestSlug = `guest-${user.id.slice(0, 8)}`;
  const email = `${guestSlug}@octo.local`;
  const now = new Date().toISOString();

  // 2. Check if principal exists
  const { data: existing } = await supabase
    .schema('octo')
    .from('principals')
    .select('*')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (existing) {
    return {
      id: existing.id,
      authUserId: existing.auth_user_id,
      email: existing.email,
      displayName: existing.display_name,
      avatarUrl: existing.avatar_url,
      isPlatformOwner: existing.is_platform_owner,
      isGuest: true,
      createdAt: existing.created_at,
      updatedAt: existing.updated_at,
    };
  }

  // 3. Create guest principal
  const { data: principalRow, error: pError } = await supabase
    .schema('octo')
    .from('principals')
    .insert({
      auth_user_id: user.id,
      email,
      display_name: displayName,
      is_platform_owner: false,
      is_guest: true,
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();

  if (pError || !principalRow) {
    throw new Error(`GUEST_PRINCIPAL_FAILED: ${pError?.message ?? 'Unknown error'}`);
  }

  const principal: Principal = {
    id: principalRow.id,
    authUserId: principalRow.auth_user_id,
    email: principalRow.email,
    displayName: principalRow.display_name,
    avatarUrl: principalRow.avatar_url,
    isPlatformOwner: false,
    isGuest: true,
    createdAt: principalRow.created_at,
    updatedAt: principalRow.updated_at,
  };

  // 4. Auto-provision default Personal (Guest) workspace
  const { data: wsRow, error: wsError } = await supabase
    .schema('octo')
    .from('workspaces')
    .insert({
      slug: guestSlug,
      name: 'Personal (Guest)',
      description: 'Default sandbox workspace for guest exploration',
      created_by: principal.id,
    })
    .select('*')
    .single();

  if (!wsError && wsRow) {
    await supabase
      .schema('octo')
      .from('workspace_memberships')
      .insert({
        workspace_id: wsRow.id,
        principal_id: principal.id,
        role: 'owner',
      });
  }

  return principal;
}
