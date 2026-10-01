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
];

/**
 * Capabilities a token may actually invoke, given its scopes.
 * A capability is included only when its required scope is present.
 */
export function capabilitiesForScopes(scopes: string[]): CapabilityDescriptor[] {
  const granted = new Set(scopes);
  return OCTO_CAPABILITIES.filter((capability) => granted.has(capability.requiredScope));
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
