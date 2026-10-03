/**
 * Mock Supabase Client with PostgreSQL Row-Level Security Simulation
 *
 * Implements realistic RLS enforcement for isolated testing of Slice 1.
 */

import { SupabaseClient, User } from '@supabase/supabase-js';
import { WorkspaceRole } from '../../src/types/auth';

export interface MockPrincipalRow {
  [key: string]: unknown;
  id: string;
  auth_user_id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  is_platform_owner: boolean;
  created_at: string;
  updated_at: string;
}

export interface MockWorkspaceRow {
  [key: string]: unknown;
  id: string;
  slug: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface MockMembershipRow {
  [key: string]: unknown;
  id: string;
  workspace_id: string;
  principal_id: string;
  role: WorkspaceRole;
  created_at: string;
  updated_at: string;
}

export interface MockFileRow {
  [key: string]: unknown;
  id: string;
  workspace_id: string;
  created_by: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  provider: string;
  storage_key: string;
  status: string;
  content_hash: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface MockApiKeyRow {
  [key: string]: unknown;
  id: string;
  key_hash: string;
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

export class MockDatabase {
  principals: MockPrincipalRow[] = [];
  workspaces: MockWorkspaceRow[] = [];
  memberships: MockMembershipRow[] = [];
  files: MockFileRow[] = [];
  api_keys: MockApiKeyRow[] = [];

  clear(): void {
    this.principals = [];
    this.workspaces = [];
    this.memberships = [];
    this.files = [];
    this.api_keys = [];
  }
}

export function createMockSupabaseClient(
  db: MockDatabase,
  initialUser: User | null
): SupabaseClient {
  let currentUser = initialUser;
  const getCurrentPrincipal = () => {
    const u = currentUser;
    return u ? db.principals.find((p) => p.auth_user_id === u.id) : undefined;
  };

  const client = {
    auth: {
      async getUser() {
        if (!currentUser) {
          return { data: { user: null }, error: new Error('UNAUTHENTICATED') };
        }
        return { data: { user: currentUser }, error: null };
      },
      async signInWithOAuth({ provider, options }: { provider: string; options?: { redirectTo?: string } }) {
        return {
          data: {
            provider,
            url: `https://accounts.google.com/o/oauth2/v2/auth?client_id=octo-mock&redirect_uri=${encodeURIComponent(options?.redirectTo ?? 'http://localhost:3000/auth/callback')}`,
          },
          error: null,
        };
      },
      async signOut() {
        return { error: null };
      },
      async signInAnonymously() {
        const anonUser: User = {
          id: `guest-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          app_metadata: { provider: 'anonymous' },
          user_metadata: {},
          aud: 'authenticated',
          created_at: new Date().toISOString(),
        };
        currentUser = anonUser;
        return { data: { user: anonUser }, error: null };
      },
    },

    schema(schemaName: string) {
      if (schemaName !== 'octo') {
        throw new Error(`Unknown schema: ${schemaName}`);
      }

      return {
        from(tableName: string) {
          return createQueryBuilder(tableName, db, () => currentUser, getCurrentPrincipal);
        },
        rpc(fnName: string, params: Record<string, unknown>) {
          if (fnName === 'verify_api_key') {
            const hash = params['target_hash'] as string;
            const key = db.api_keys.find((k) => k.key_hash === hash);
            if (key) {
              key.last_used_at = new Date().toISOString();
              return Promise.resolve({ data: [key], error: null });
            }
            return Promise.resolve({ data: null, error: null });
          }
          return Promise.resolve({ data: null, error: new Error(`Unknown RPC: ${fnName}`) });
        },
      };
    },
  };

  return client as unknown as SupabaseClient;
}

interface FilterCondition {
  field: string;
  value: unknown;
}

function createQueryBuilder(
  tableName: string,
  db: MockDatabase,
  getCurrentUser: () => User | null,
  getCurrentPrincipal: () => MockPrincipalRow | undefined
) {
  const filters: FilterCondition[] = [];
  let selectFields = '*';

  const builder = {
    select(fields = '*') {
      selectFields = fields;
      return builder;
    },

    eq(field: string, value: unknown) {
      filters.push({ field, value });
      return builder;
    },

    order(_field: string, _options?: { ascending?: boolean }) {
      return builder;
    },

    async maybeSingle() {
      const results = await builder._execute();
      return { data: results[0] ?? null, error: null };
    },

    async single() {
      const results = await builder._execute();
      if (results.length === 0) {
        return { data: null, error: new Error('PGRST116: JSON object requested, multiple (or no) rows returned') };
      }
      return { data: results[0], error: null };
    },

    insert(records: Record<string, unknown> | Record<string, unknown>[]) {
      const items = Array.isArray(records) ? records : [records];
      const inserted: unknown[] = [];
      let insertError: Error | null = null;

      const currentUser = getCurrentUser();
      for (const item of items) {
        if (tableName === 'principals') {
          if (!currentUser || item['auth_user_id'] !== currentUser.id) {
            insertError = new Error('RLS_VIOLATION: Cannot insert principal for another user');
            break;
          }
          if (item['is_platform_owner'] === true) {
            insertError = new Error('RLS_VIOLATION: Client cannot self-promote to platform owner');
            break;
          }

          const row: MockPrincipalRow = {
            id: (item['id'] as string) ?? `p-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            auth_user_id: item['auth_user_id'] as string,
            email: item['email'] as string,
            display_name: (item['display_name'] as string | null) ?? null,
            avatar_url: (item['avatar_url'] as string | null) ?? null,
            is_platform_owner: Boolean(item['is_platform_owner']),
            is_guest: Boolean(item['is_guest']),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          db.principals.push(row);
          inserted.push(row);
        } else if (tableName === 'workspaces') {
          const principal = getCurrentPrincipal();
          if (!currentUser || !principal) {
            insertError = new Error('RLS_VIOLATION: Unauthenticated workspace creation denied');
            break;
          }
          const row: MockWorkspaceRow = {
            id: (item['id'] as string) ?? `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            slug: item['slug'] as string,
            name: item['name'] as string,
            description: (item['description'] as string | null) ?? null,
            created_by: principal.id,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          db.workspaces.push(row);
          inserted.push(row);
        } else if (tableName === 'workspace_memberships') {
          const row: MockMembershipRow = {
            id: (item['id'] as string) ?? `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            workspace_id: item['workspace_id'] as string,
            principal_id: item['principal_id'] as string,
            role: item['role'] as WorkspaceRole,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          db.memberships.push(row);
          inserted.push(row);
        } else if (tableName === 'files') {
          const row: MockFileRow = {
            id: (item['id'] as string) ?? `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            workspace_id: item['workspace_id'] as string,
            created_by: item['created_by'] as string,
            name: item['name'] as string,
            mime_type: item['mime_type'] as string,
            size_bytes: Number(item['size_bytes'] ?? 0),
            provider: (item['provider'] as string) ?? 'r2',
            storage_key: item['storage_key'] as string,
            status: (item['status'] as string) ?? 'active',
            content_hash: (item['content_hash'] as string | null) ?? null,
            metadata: (item['metadata'] as Record<string, unknown>) ?? {},
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          db.files.push(row);
          inserted.push(row);
        } else if (tableName === 'api_keys') {
          const row: MockApiKeyRow = {
            id: (item['id'] as string) ?? `key-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            key_hash: item['key_hash'] as string,
            prefix: item['prefix'] as string,
            name: item['name'] as string,
            principal_id: item['principal_id'] as string,
            workspace_id: (item['workspace_id'] as string | null) ?? null,
            role: (item['role'] as WorkspaceRole | null) ?? null,
            scopes: (item['scopes'] as string[]) ?? ['read', 'write'],
            expires_at: (item['expires_at'] as string | null) ?? null,
            created_at: new Date().toISOString(),
            last_used_at: null,
          };
          db.api_keys.push(row);
          inserted.push(row);
        }
      }

      const result = {
        select(_selectField = '*') {
          return {
            async single() {
              return { data: inserted[0] ?? null, error: insertError };
            },
            async maybeSingle() {
              return { data: inserted[0] ?? null, error: insertError };
            },
            async then(resolve: (val: { data: unknown[]; error: Error | null }) => void) {
              resolve({ data: inserted, error: insertError });
            },
          };
        },
        async single() {
          return { data: inserted[0] ?? null, error: insertError };
        },
        async maybeSingle() {
          return { data: inserted[0] ?? null, error: insertError };
        },
        async then(resolve: (val: { data: unknown[]; error: Error | null }) => void) {
          resolve({ data: inserted, error: insertError });
        },
        data: inserted,
        error: insertError,
      };

      return result;
    },

    upsert(record: Record<string, unknown>) {
      return builder.insert(record);
    },

    delete() {
      const deletePromise = {
        eq(field: string, value: unknown) {
          filters.push({ field, value });
          return deletePromise;
        },
        async then(resolve: (val: { data: null; error: null }) => void) {
          if (tableName === 'workspace_memberships') {
            const wsIdFilter = filters.find((f) => f.field === 'workspace_id')?.value;
            const pIdFilter = filters.find((f) => f.field === 'principal_id')?.value;
            db.memberships = db.memberships.filter((m) => {
              if (wsIdFilter && m.workspace_id !== wsIdFilter) return true;
              if (pIdFilter && m.principal_id !== pIdFilter) return true;
              return false;
            });
          }
          if (tableName === 'files') {
            const idFilter = filters.find((f) => f.field === 'id')?.value;
            db.files = db.files.filter((f) => (idFilter ? f.id !== idFilter : true));
          }
          if (tableName === 'api_keys') {
            const idFilter = filters.find((f) => f.field === 'id')?.value;
            db.api_keys = db.api_keys.filter((k) => (idFilter ? k.id !== idFilter : true));
          }
          resolve({ data: null, error: null });
        },
      };
      return deletePromise;
    },

    async then(resolve: (val: { data: unknown[]; error: null }) => void) {
      const data = await builder._execute();
      resolve({ data, error: null });
    },

    async _execute(): Promise<unknown[]> {
      const currentUser = getCurrentUser();
      const currentPrincipal = getCurrentPrincipal();

      if (tableName === 'principals') {
        return db.principals.filter((p) => {
          if (!currentUser) return false;
          if (p.auth_user_id !== currentUser.id && p.id !== currentPrincipal?.id) {
            return false;
          }
          return matchesFilters(p, filters);
        });
      }

      if (tableName === 'workspaces') {
        return db.workspaces
          .filter((ws) => {
            if (!currentPrincipal) return false;
            const isCreator = ws.created_by === currentPrincipal.id;
            const hasMembership = db.memberships.some(
              (m) => m.workspace_id === ws.id && m.principal_id === currentPrincipal.id
            );
            if (!isCreator && !hasMembership) return false;
            return matchesFilters(ws, filters);
          })
          .map((ws) => {
            if (selectFields.includes('workspace_memberships')) {
              const mems = db.memberships.filter(
                (m) => m.workspace_id === ws.id && m.principal_id === currentPrincipal?.id
              );
              return {
                ...ws,
                workspace_memberships: mems.map((m) => ({ role: m.role })),
              };
            }
            return ws;
          });
      }

      if (tableName === 'workspace_memberships') {
        return db.memberships.filter((m) => {
          if (!currentPrincipal) return false;
          const userIsInWorkspace = db.memberships.some(
            (other) => other.workspace_id === m.workspace_id && other.principal_id === currentPrincipal.id
          );
          if (!userIsInWorkspace) return false;
          return matchesFilters(m, filters);
        });
      }
      if (tableName === 'files') {
        return db.files.filter((f) => {
          if (!currentPrincipal) return false;
          const userIsInWorkspace = db.memberships.some(
            (m) => m.workspace_id === f.workspace_id && m.principal_id === currentPrincipal.id
          );
          if (!userIsInWorkspace) return false;
          return matchesFilters(f, filters);
        });
      }

      if (tableName === 'api_keys') {
        return db.api_keys.filter((k) => {
          if (!currentPrincipal) return false;
          if (k.principal_id !== currentPrincipal.id) return false;
          return matchesFilters(k, filters);
        });
      }

      return [];
    },
  };

  return builder;
}

function matchesFilters(record: Record<string, unknown>, filters: FilterCondition[]): boolean {
  for (const filter of filters) {
    if (record[filter.field] !== filter.value) {
      return false;
    }
  }
  return true;
}
