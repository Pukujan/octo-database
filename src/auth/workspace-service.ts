/**
 * Database-Backed Workspace Service (Slice 1)
 *
 * Implements workspace creation, membership updates, and entry validation.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  Principal,
  Workspace,
  WorkspaceMembership,
  WorkspaceRole,
  WorkspaceSummary,
} from '../types/auth';
import { evaluateWorkspaceAccess, listAuthorizedWorkspaces } from './authorization';

export interface CreateWorkspaceInput {
  name: string;
  slug: string;
  description?: string;
}

export interface WorkspaceContext {
  workspace: Workspace;
  role: WorkspaceRole;
  principal: Principal;
  capabilities: {
    canManageMembers: boolean;
    canUploadFiles: boolean;
    canDeleteWorkspace: boolean;
    canManageSettings: boolean;
  };
}

/**
 * Creates a new workspace and automatically records the creator as 'owner'.
 */
export async function createWorkspace(
  supabase: SupabaseClient,
  creator: Principal,
  input: CreateWorkspaceInput
): Promise<WorkspaceContext> {
  const slug = input.slug.toLowerCase().trim();
  const name = input.name.trim();

  // 1. Insert workspace row
  const { data: wsData, error: wsError } = await supabase
    .schema('octo')
    .from('workspaces')
    .insert({
      slug,
      name,
      description: input.description ?? null,
      created_by: creator.id,
    })
    .select('*')
    .single();

  if (wsError || !wsData) {
    throw new Error(`WORKSPACE_CREATE_FAILED: ${wsError?.message ?? 'Unknown error'}`);
  }

  // 2. Insert creator as owner in workspace_memberships
  const { error: memError } = await supabase
    .schema('octo')
    .from('workspace_memberships')
    .insert({
      workspace_id: wsData.id,
      principal_id: creator.id,
      role: 'owner',
    });

  if (memError) {
    throw new Error(`MEMBERSHIP_CREATE_FAILED: ${memError.message}`);
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

  return {
    workspace,
    role: 'owner',
    principal: creator,
    capabilities: {
      canManageMembers: true,
      canUploadFiles: true,
      canDeleteWorkspace: true,
      canManageSettings: true,
    },
  };
}

/**
 * Enters an active workspace session, validating access through RLS.
 * Fails closed if the principal lacks membership.
 */
export async function enterWorkspace(
  supabase: SupabaseClient,
  principal: Principal,
  workspaceId: string
): Promise<WorkspaceContext> {
  const access = await evaluateWorkspaceAccess(supabase, workspaceId);

  if (!access.allowed || !access.role || !access.workspace) {
    throw new Error(`FORBIDDEN: Access denied to workspace ${workspaceId}`);
  }

  const role = access.role;

  return {
    workspace: access.workspace,
    role,
    principal,
    capabilities: {
      canManageMembers: role === 'owner' || role === 'admin',
      canUploadFiles: role === 'owner' || role === 'admin' || role === 'operator',
      canDeleteWorkspace: role === 'owner',
      canManageSettings: role === 'owner' || role === 'admin',
    },
  };
}

/**
 * Invites or registers a member in a workspace.
 */
export async function addWorkspaceMember(
  supabase: SupabaseClient,
  workspaceId: string,
  targetPrincipalId: string,
  role: WorkspaceRole
): Promise<WorkspaceMembership> {
  const { data, error } = await supabase
    .schema('octo')
    .from('workspace_memberships')
    .upsert({
      workspace_id: workspaceId,
      principal_id: targetPrincipalId,
      role,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`MEMBER_ADD_FAILED: ${error?.message ?? 'Unknown error'}`);
  }

  return {
    id: data.id,
    workspaceId: data.workspace_id,
    principalId: data.principal_id,
    role: data.role as WorkspaceRole,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

/**
 * Removes a member from a workspace.
 */
export async function removeWorkspaceMember(
  supabase: SupabaseClient,
  workspaceId: string,
  targetPrincipalId: string
): Promise<void> {
  const { error } = await supabase
    .schema('octo')
    .from('workspace_memberships')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('principal_id', targetPrincipalId);

  if (error) {
    throw new Error(`MEMBER_REMOVE_FAILED: ${error.message}`);
  }
}

export async function getAuthorizedWorkspaces(
  supabase: SupabaseClient
): Promise<WorkspaceSummary[]> {
  return listAuthorizedWorkspaces(supabase);
}
