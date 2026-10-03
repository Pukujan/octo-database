/**
 * Agent Capability Discovery and Scope Enforcement (Slice 7)
 *
 * Capability discovery describes HOW to call Octo. The token's scopes define WHAT
 * the principal may do, and they are enforced server-side on every call -- the
 * description is documentation, never the enforcement mechanism.
 */

export type OctoScope = 'read' | 'write' | 'delete' | 'files' | 'admin';

export interface CapabilityDescriptor {
  action: string;
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  /** Scope required to invoke this action. */
  requiredScope: OctoScope;
  description: string;
}

/**
 * The platform surface agents may call. Ordering is stable so capability output is
 * deterministic and diffable.
 */
export const OCTO_CAPABILITIES: CapabilityDescriptor[] = [
  {
    action: 'workspaces.list',
    method: 'GET',
    path: '/api/workspaces',
    requiredScope: 'read',
    description: 'List workspaces this principal is authorized to use.',
  },
  {
    action: 'workspaces.create',
    method: 'POST',
    path: '/api/workspaces',
    requiredScope: 'write',
    description:
      'Create a workspace (workspace = database) and auto-provision its key. Not available to workspace-scoped keys.',
  },
  {
    action: 'files.list',
    method: 'GET',
    path: '/api/files?workspaceId=<id>',
    requiredScope: 'files',
    description: 'List active files in an authorized workspace.',
  },
  {
    action: 'files.download',
    method: 'GET',
    path: '/api/files/download?workspaceId=<id>&fileId=<id>',
    requiredScope: 'files',
    description: 'Get a short-lived download URL for one file.',
  },
  {
    action: 'files.upload',
    method: 'POST',
    path: '/api/files/upload',
    requiredScope: 'write',
    description: 'Upload bytes into an authorized workspace.',
  },
  {
    action: 'files.delete',
    method: 'DELETE',
    path: '/api/files/<fileId>?workspaceId=<id>',
    requiredScope: 'delete',
    description: 'Delete a file. Destructive; requires the delete scope.',
  },
  {
    action: 'files.archive',
    method: 'POST',
    path: '/api/files/<fileId>/archive?workspaceId=<id>',
    requiredScope: 'delete',
    description: 'Move a file from active storage to the cold archive. Restored on demand.',
  },
  {
    action: 'files.restore',
    method: 'POST',
    path: '/api/files/<fileId>/restore?workspaceId=<id>',
    requiredScope: 'write',
    description: 'Pull an archived file back into active storage.',
  },
  {
    action: 'jobs.list',
    method: 'GET',
    path: '/api/jobs?workspaceId=<id>',
    requiredScope: 'read',
    description: 'List background jobs for an authorized workspace.',
  },
  {
    action: 'jobs.enqueue',
    method: 'POST',
    path: '/api/jobs',
    requiredScope: 'write',
    description: 'Enqueue background work in an authorized workspace.',
  },
  {
    action: 'gallery.list',
    method: 'GET',
    path: '/api/gallery?workspaceId=<id>',
    requiredScope: 'files',
    description: 'List gallery media in an authorized workspace.',
  },
  {
    action: 'jobs.run',
    method: 'POST',
    path: '/api/jobs/run?workspaceId=<id>',
    requiredScope: 'write',
    description: 'Drain one pass of the background job queue for an authorized workspace.',
  },
  {
    action: 'activity.list',
    method: 'GET',
    path: '/api/activity?workspaceId=<id>',
    requiredScope: 'read',
    description: 'Read the activity feed for an authorized workspace.',
  },
  {
    action: 'keys.revoke',
    method: 'DELETE',
    path: '/api/keys/<keyId>',
    requiredScope: 'delete',
    description: 'Revoke one of this principal\'s API keys. Destructive.',
  },
];

/**
 * Actions that require the `admin` scope. `admin` names cross-tenant authority,
 * so it is platform-owner-only: a key may carry it only when its principal is a
 * platform owner, and only a platform owner may grant it. Listed separately so
 * the enforcement is visible rather than implied.
 */
export const ADMIN_CAPABILITIES: CapabilityDescriptor[] = [
  {
    action: 'workspaces.delete.any',
    method: 'DELETE',
    path: '/api/workspaces/<id>',
    requiredScope: 'admin',
    description:
      'Delete a workspace the caller does not own. Also requires a human session and the confirmation secret.',
  },
];

/**
 * Named permission presets for the key picker, mapped onto the five real scopes.
 * `custom` means an explicit scope list instead.
 */
export const SCOPE_PRESETS: { id: string; label: string; scopes: OctoScope[] }[] = [
  { id: 'read-only', label: 'Read-only', scopes: ['read', 'files'] },
  { id: 'read-write', label: 'Read-write', scopes: ['read', 'write', 'files'] },
  { id: 'ingest', label: 'Ingest', scopes: ['write', 'files'] },
  { id: 'full', label: 'Full', scopes: ['read', 'write', 'files', 'delete'] },
];

/**
 * Capabilities a token may actually invoke, given its scopes.
 * A capability is included only when its required scope is present.
 */
export function capabilitiesForScopes(scopes: string[]): CapabilityDescriptor[] {
  const granted = new Set(scopes);
  return OCTO_CAPABILITIES.filter((capability) => granted.has(capability.requiredScope));
}

/** Workspace role required for the operations exposed by the current inventory. */
export function minimumRoleForCapability(action: string): 'member' | 'operator' | 'admin' {
  if (action === 'files.delete') return 'admin';
  if (['files.upload', 'files.archive', 'files.restore', 'jobs.enqueue', 'jobs.run'].includes(action)) {
    return 'operator';
  }
  return 'member';
}

/** True when the granted scopes permit the required scope. */
export function hasScope(scopes: string[], required: OctoScope): boolean {
  return scopes.includes(required);
}

/**
 * Human/agent-facing description of how to authenticate. Contains no secrets and
 * no infrastructure credentials -- only the shape of the call.
 */
export const AUTH_GUIDANCE = {
  scheme: 'Bearer',
  header: 'Authorization: Bearer <octo_live_...>',
  note:
    'Agent tokens grant only their listed scopes within their bound workspace (or all ' +
    'authorized workspaces for account-wide keys). They never expose provider, database, ' +
    'or infrastructure credentials.',
} as const;
