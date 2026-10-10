// Row and response shapes, taken verbatim from the API inventory in
// docs/specs/2026-10-10-frontend-v2-spec.md §10. Nothing here is invented.

export interface Principal {
  id: string;
  authUserId?: string | null;
  email: string | null;
  displayName: string | null;
  avatarUrl?: string | null;
  isGuest: boolean;
  isPlatformOwner: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface HealthResponse {
  status: string;
  version: string;
  database: { connected: boolean; version?: string };
  r2: { connected: boolean; bucket: string | null };
  googleAuthEnabled: boolean;
  turnstileSiteKey: string | null;
}

export interface MeResponse {
  principal: Principal;
  apiKey: { id: string; scopes: string[] } | null;
  confirmSecretSet: boolean;
  mfaEnabled: boolean;
  mfaRecoveryCodesRemaining: number;
}

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  role: string;
  isOwner: boolean;
  retentionDays: number | null;
}

export type ArchiveState = string;

export interface FileRecord {
  id: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  storageKey: string;
  createdAt: string;
  archiveState: ArchiveState;
  publishedAt: string | null;
  publishedUrl: string | null;
}

export interface GalleryItem {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: 'image' | 'video';
  thumbnailUrl: string;
  fullUrl: string;
  createdAt: string;
}

export interface ApiKeyRow {
  id: string;
  prefix: string;
  name: string;
  workspaceId: string | null;
  workspaceName: string | null;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  isAccountWide: boolean;
}

export interface ShareRow {
  id: string;
  workspaceId: string;
  resourceType: string;
  resourceId: string | null;
  tokenPrefix: string;
  permission: string;
  validFrom: string | null;
  validUntil: string | null;
  revokedAt: string | null;
  createdAt: string;
  lastAccessedAt: string | null;
  accessCount: number;
}

export interface JobRow {
  id: string;
  jobType: string;
  state: string;
  attempts: number;
  maxAttempts: number;
  errorSummary: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ActivityRow {
  id: string;
  eventType: string;
  summary: string;
  jobId: string | null;
  createdAt: string;
}

export interface OpsSummary {
  failureCounts: {
    errorCode: string | null;
    severity: string | null;
    source: string | null;
    eventCount: number;
    lastSeen: string | null;
  }[];
  failuresByJobTypeDay: {
    day: string;
    jobType: string;
    errorCode: string | null;
    eventCount: number;
  }[];
  unhealthyJobs: {
    jobId: string;
    jobType: string;
    state: string;
    attempt: number;
    maxAttempts: number;
    updatedAt: string;
    errorCode: string | null;
  }[];
}

export interface PublicShare {
  share: {
    id: string;
    resourceType: string;
    permission: string;
    validUntil: string | null;
  };
  items: GalleryItem[];
}

export interface MfaStatus {
  enabled: boolean;
  confirmedAt: string | null;
  recoveryCodesRemaining: number;
}

export const KEY_SCOPES = ['read', 'write', 'files', 'delete'] as const;
export type KeyScope = (typeof KEY_SCOPES)[number];
