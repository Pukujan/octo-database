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

export class MockDatabase {
  principals: MockPrincipalRow[] = [];
  workspaces: MockWorkspaceRow[] = [];
  memberships: MockMembershipRow[] = [];

  clear(): void {
    this.principals = [];
    this.workspaces = [];
    this.memberships = [];
  }
}

export function createMockSupabaseClient(
  db: MockDatabase,
  currentUser: User | null
): SupabaseClient {
  const getCurrentPrincipal = () =>
    currentUser
      ? db.principals.find((p) => p.auth_user_id === currentUser.id)
      : undefined;

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
    },

    schema(schemaName: string) {
      if (schemaName !== 'octo') {
        throw new Error(`Unknown schema: ${schemaName}`);
      }

      return {
        from(tableName: string) {
          return createQueryBuilder(tableName, db, currentUser, getCurrentPrincipal);
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
  currentUser: User | null,
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

    async delete() {
      // Find matching items and delete
      if (tableName === 'workspace_memberships') {
        const wsIdFilter = filters.find((f) => f.field === 'workspace_id')?.value;
        const pIdFilter = filters.find((f) => f.field === 'principal_id')?.value;

        db.memberships = db.memberships.filter((m) => {
          if (wsIdFilter && m.workspace_id !== wsIdFilter) return true;
          if (pIdFilter && m.principal_id !== pIdFilter) return true;
          return false;
        });
      }
      return { error: null };
    },

    async then(resolve: (val: { data: unknown[]; error: null }) => void) {
      const data = await builder._execute();
      resolve({ data, error: null });
    },

    async _execute(): Promise<unknown[]> {
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
