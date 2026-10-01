/**
 * Octo Supabase Client Factory (Slice 1)
 *
 * Uses anon key or session JWT. Never leaks service-role keys into client code.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface OctoClientConfig {
  supabaseUrl: string;
  supabaseKey: string;
  authToken?: string;
}

/**
 * Creates a configured Supabase client.
 * If an authToken (JWT) is provided, it is attached to the auth headers.
 */
export function createOctoClient(config: OctoClientConfig): SupabaseClient {
  const { supabaseUrl, supabaseKey, authToken } = config;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('CONFIG_ERROR: supabaseUrl and supabaseKey are required');
  }

  const options = authToken
    ? {
        global: {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        },
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    : {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
        },
      };

  return createClient(supabaseUrl, supabaseKey, options);
}
