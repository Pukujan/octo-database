/**
 * Octo Platform API Gateway (Slice 7 / Issue #9)
 *
 * Routes incoming API requests for database workspaces and file operations.
 * Enforces account-wide vs workspace-scoped authorization boundaries.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { Principal, WorkspaceRole } from '../types/auth';
import { evaluateWorkspaceAccess, listAuthorizedWorkspaces } from '../auth/authorization';
import { enterWorkspace } from '../auth/workspace-service';
import {
  deleteWorkspaceFile,
  getWorkspaceFile,
  listWorkspaceFiles,
  uploadWorkspaceFile,
} from '../storage/file-service';
import { R2StorageProvider } from '../storage/r2-client';
import { verifyApiKey } from './keys';

export type ApiAction =
  | 'workspaces.list'
  | 'workspaces.get'
  | 'files.list'
  | 'files.get'
  | 'files.upload'
  | 'files.delete';

export interface ApiRequest {
  bearerToken: string;
  action: ApiAction;
  workspaceId?: string;
  payload?: Record<string, unknown>;
}

export interface ApiResponse<T = unknown> {
  status: number;
  data?: T;
  error?: string;
}

/**
 * Handles an API request across the Octo platform boundary.
 * Fails closed on authentication failure, invalid workspace scoping, or unauthorized action.
 */
export async function handleApiRequest(
  supabase: SupabaseClient,
  r2: R2StorageProvider,
  request: ApiRequest
): Promise<ApiResponse> {
  const { bearerToken, action, workspaceId, payload } = request;

  if (!bearerToken) {
    return { status: 401, error: 'UNAUTHENTICATED: Bearer token is required' };
  }

  // 1. Verify API Key
  const verifiedKey = await verifyApiKey(supabase, bearerToken);
  if (!verifiedKey) {
    return { status: 401, error: 'UNAUTHORIZED: Invalid, expired, or revoked API key' };
  }

  const { principal, isAccountWide, workspaceId: boundWorkspaceId } = verifiedKey;

  // 2. Enforce Scoping Rules
  if (!isAccountWide && boundWorkspaceId) {
    // Workspace-scoped key: MUST ONLY target its bound workspace
    if (workspaceId && workspaceId !== boundWorkspaceId) {
      return {
        status: 403,
        error: `FORBIDDEN: This API key is restricted to workspace ${boundWorkspaceId}`,
      };
    }
  }

  const targetWorkspaceId = workspaceId ?? boundWorkspaceId;

  // 3. Dispatch Actions
  try {
    switch (action) {
      case 'workspaces.list': {
        if (!isAccountWide && boundWorkspaceId) {
          // Scoped key can only view its assigned workspace
          const access = await evaluateWorkspaceAccess(supabase, boundWorkspaceId);
          if (!access.allowed || !access.workspace) {
            return { status: 200, data: [] };
          }
          return {
            status: 200,
            data: [
              {
                id: access.workspace.id,
                slug: access.workspace.slug,
                name: access.workspace.name,
                role: access.role,
                isOwner: access.role === 'owner',
              },
            ],
          };
        }

        // Account-wide key: lists all authorized workspaces for principal
        const workspaces = await listAuthorizedWorkspaces(supabase);
        return { status: 200, data: workspaces };
      }

      case 'workspaces.get': {
        if (!targetWorkspaceId) {
          return { status: 400, error: 'BAD_REQUEST: workspaceId is required' };
        }
        const context = await enterWorkspace(supabase, principal, targetWorkspaceId);
        return { status: 200, data: context };
      }

      case 'files.list': {
        if (!targetWorkspaceId) {
          return { status: 400, error: 'BAD_REQUEST: workspaceId is required' };
        }
        const files = await listWorkspaceFiles(supabase, targetWorkspaceId);
        return { status: 200, data: files };
      }

      case 'files.get': {
        if (!targetWorkspaceId) {
          return { status: 400, error: 'BAD_REQUEST: workspaceId is required' };
        }
        const fileId = payload?.['fileId'] as string | undefined;
        if (!fileId) {
          return { status: 400, error: 'BAD_REQUEST: fileId is required in payload' };
        }
        const fileWithUrl = await getWorkspaceFile(supabase, r2, principal, targetWorkspaceId, fileId);
        return { status: 200, data: fileWithUrl };
      }

      case 'files.upload': {
        if (!targetWorkspaceId) {
          return { status: 400, error: 'BAD_REQUEST: workspaceId is required' };
        }
        const name = payload?.['name'] as string | undefined;
        const mimeType = (payload?.['mimeType'] as string | undefined) ?? 'application/octet-stream';
        const data = payload?.['data'] as string | Uint8Array | undefined;

        if (!name || data === undefined) {
          return { status: 400, error: 'BAD_REQUEST: name and data are required in payload' };
        }

        const fileRecord = await uploadWorkspaceFile(supabase, r2, principal, targetWorkspaceId, {
          name,
          mimeType,
          data,
          metadata: (payload?.['metadata'] as Record<string, unknown> | undefined) ?? {},
        });

        return { status: 201, data: fileRecord };
      }

      case 'files.delete': {
        if (!targetWorkspaceId) {
          return { status: 400, error: 'BAD_REQUEST: workspaceId is required' };
        }
        const fileId = payload?.['fileId'] as string | undefined;
        if (!fileId) {
          return { status: 400, error: 'BAD_REQUEST: fileId is required in payload' };
        }

        await deleteWorkspaceFile(supabase, r2, principal, targetWorkspaceId, fileId);
        return { status: 200, data: { success: true, fileId } };
      }

      default:
        return { status: 400, error: `BAD_REQUEST: Unknown action: ${action}` };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith('FORBIDDEN:')) {
      return { status: 403, error: message };
    }
    if (message.startsWith('FILE_NOT_FOUND:')) {
      return { status: 404, error: message };
    }
    return { status: 500, error: `INTERNAL_ERROR: ${message}` };
  }
}
