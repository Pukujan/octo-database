/**
 * Octo Authorization & Identity Types (Slice 1)
 */

export type WorkspaceRole = 'owner' | 'admin' | 'operator' | 'member';

export const ROLE_HIERARCHY: Record<WorkspaceRole, number> = {
  owner: 4,
  admin: 3,
  operator: 2,
  member: 1,
};

export interface Principal {
  id: string;
  authUserId: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  isPlatformOwner: boolean;
  isGuest: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMembership {
  id: string;
  workspaceId: string;
  principalId: string;
  role: WorkspaceRole;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  role: WorkspaceRole;
  isOwner: boolean;
  /** Days after which active files auto-archive to Drive; null = never. */
  retentionDays?: number | null;
}

export interface Session {
  sessionId: string;
  principal: Principal;
  expiresAt: number; // Unix timestamp in seconds
  createdAt: number;
}

export interface GoogleAuthPayload {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
}

export interface WorkspaceAccessResult {
  allowed: boolean;
  role?: WorkspaceRole;
  principal?: Principal;
  workspace?: Workspace;
  reason?: string;
}
