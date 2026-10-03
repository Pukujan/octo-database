/**
 * Database-Backed Workspace Authorization Engine (Slice 1)
 *
 * Derives workspace access and roles from canonical membership records in PostgreSQL.
 * Uses PostgreSQL Row-Level Security (RLS) as the primary fail-closed boundary.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  ROLE_HIERARCHY,
  Workspace,
  WorkspaceAccessResult,
  WorkspaceRole,
  WorkspaceSummary,
} from '../types/auth';

/**
 * Lists only the workspaces the authenticated user is authorized to see.
 * Relies on PostgreSQL RLS policy `workspaces_select_member` to filter rows.
 */
export async function listAuthorizedWorkspaces(
  supabase: SupabaseClient
): Promise<WorkspaceSummary[]> {
  const { data, error } = await supabase
    .schema('octo')
    .from('workspaces')
    .select(`
      id,
      slug,
      name,
      description,
      workspace_memberships (
        role
      )
    `);

  if (error) {
    throw new Error(`AUTHORIZATION_ERROR: Failed to list workspaces: ${error.message}`);
  }

  if (!data) {
    return [];
  }

  interface QueryRow {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    workspace_memberships: { role: WorkspaceRole }[] | { role: WorkspaceRole } | null;
  }

  const rows = data as unknown as QueryRow[];
  const summaries: WorkspaceSummary[] = [];

  for (const row of rows) {
    const rawMemberships = row.workspace_memberships;
    let role: WorkspaceRole = 'member';

    if (Array.isArray(rawMemberships) && rawMemberships.length > 0) {
      role = rawMemberships[0].role;
    } else if (rawMemberships && !Array.isArray(rawMemberships)) {
      role = rawMemberships.role;
    }

    summaries.push({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      role,
      isOwner: role === 'owner',
    });
  }

  return summaries.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Evaluates whether the authenticated user has access to a specific workspace.
 * Fails closed if the workspace does not exist or user has no membership.
 */
export async function evaluateWorkspaceAccess(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<WorkspaceAccessResult> {
  if (!workspaceId) {
    return { allowed: false, reason: 'INVALID_WORKSPACE_ID' };
  }

  // 1. Query workspace (RLS filters out any workspace user has no membership in)
  const { data: wsData, error: wsError } = await supabase
    .schema('octo')
    .from('workspaces')
    .select('id, slug, name, description, created_by, created_at, updated_at')
    .eq('id', workspaceId)
    .maybeSingle();

  if (wsError || !wsData) {
    return { allowed: false, reason: 'WORKSPACE_ACCESS_DENIED' };
  }

  // 2. Query membership to resolve the specific role
  const { data: memData, error: memError } = await supabase
    .schema('octo')
    .from('workspace_memberships')
    .select('role')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (memError || !memData) {
    return { allowed: false, reason: 'MEMBERSHIP_NOT_FOUND' };
  }

  const workspace: Workspace = {
    id: wsData.id,
    slug: wsData.slug,
    name: wsData.name,
    description: wsData.description,
    createdBy: wsData.created_by,
    createdAt: wsData.created_at,
    updatedAt: wsData.updated_at,
  };

  const role = memData.role as WorkspaceRole;

  return {
    allowed: true,
    role,
    workspace,
  };
}

/**
 * Checks whether the authenticated user holds at least the minimum required role.
 */
export async function hasMinimumRole(
  supabase: SupabaseClient,
  workspaceId: string,
  minRole: WorkspaceRole
): Promise<boolean> {
  const result = await evaluateWorkspaceAccess(supabase, workspaceId);
  if (!result.allowed || !result.role) {
    return false;
  }
  return ROLE_HIERARCHY[result.role] >= ROLE_HIERARCHY[minRole];
}
