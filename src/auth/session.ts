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
