/**
 * Domain shapes mirroring the live Octo contract.
 *
 * These intentionally match the server DTOs described in
 * docs/frontend/DYAD_DASHBOARD_BRIEF.md so the demo adapter and the live
 * adapter are structurally interchangeable.
 */

export type WorkspaceRole = "owner" | "admin" | "operator" | "member";

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

export interface WorkspaceSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  role: WorkspaceRole;
  isOwner: boolean;
  retentionDays?: number | null;
}

export type ArchiveState =
  | "active_r2"
  | "archiving"
  | "archived_drive"
  | "restoring"
  | "reconciliation_required";

export interface FileRecord {
  id: string;
  workspaceId: string;
  createdBy: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  provider: string;
  storageKey: string;
  status: "pending" | "active" | "deleted";
  contentHash: string | null;
  archiveState?: ArchiveState | string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type JobState = "queued" | "running" | "completed" | "failed" | "paused";

export interface JobRecord {
  id: string;
  workspaceId: string;
  jobType: string;
  state: JobState;
  idempotencyKey: string;
  attempt: number;
  maxAttempts: number;
  availableAt: string;
  leaseExpiresAt: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  errorCode: string | null;
  errorSummary: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityRecord {
  id: string;
  eventType: string;
  summary: string;
  jobId: string | null;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  prefix: string;
  name: string;
  principalId: string;
  workspaceId: string | null;
  role: WorkspaceRole | null;
  scopes: string[];
  expiresAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  isAccountWide: boolean;
}

export interface GalleryItem {
  id: string;
  workspaceId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: "image" | "video";
  storageKey: string;
  thumbnailUrl: string;
  fullUrl: string;
  createdAt: string;
}

export interface ShareSummary {
  id: string;
  workspaceId: string;
  resourceType: string;
  permission: string;
  validUntil: string | null;
  revokedAt: string | null;
  createdAt: string;
  active: boolean;
}

export interface HealthStatus {
  status: string;
  version: string;
  database: { connected: boolean; version: string | null };
  r2: { connected: boolean; bucket: string | null };
  googleAuthEnabled: boolean;
  /** When the client observed this status; server does not return it. */
  observedAt: string;
}

export interface CapabilityDescriptor {
  id: string;
  label: string;
  description: string;
  method: string;
  path: string;
  scope: string | null;
  available: boolean;
}

export interface MeResponse {
  principal: Principal;
  apiKey: ApiKey | null;
  confirmSecretSet: boolean;
}

/**
 * Derived, client-side aggregate over a workspace's file catalog.
 *
 * This is metadata accounting ("recorded file usage"), NOT physical bucket
 * usage and NOT remaining provider capacity.
 */
export interface StorageSnapshot {
  workspaceId: string;
  observedAt: string;
  usedBytes: number;
  fileCount: number;
  activeR2Bytes: number;
  archivedDriveBytes: number;
  transitioningBytes: number;
}

export interface DemoFlag {
  /** True when a value is illustrative and must be labelled "Demo data". */
  demo: boolean;
}
