import type {
  ActivityRecord,
  ApiKey,
  CapabilityDescriptor,
  FileRecord,
  GalleryItem,
  HealthStatus,
  JobRecord,
  MeResponse,
  ShareSummary,
  WorkspaceRole,
  WorkspaceSummary,
} from "@v2/types/octo";

/**
 * The single seam between page components and data.
 *
 * Pages never call fetch directly. They call an `OctoApi`. Swapping demo
 * fixtures for the live server is a one-line provider change, and the pages
 * are unaware of which is in use.
 */
export interface OctoApi {
  readonly mode: DataMode;

  getMe(): Promise<MeResponse>;
  listWorkspaces(): Promise<WorkspaceSummary[]>;
  listFiles(workspaceId: string): Promise<FileRecord[]>;
  listGallery(workspaceId: string): Promise<GalleryItem[]>;
  listJobs(workspaceId: string): Promise<JobRecord[]>;
  listActivity(workspaceId: string): Promise<ActivityRecord[]>;
  listKeys(): Promise<ApiKey[]>;
  listShares(workspaceId: string): Promise<ShareSummary[]>;
  listCapabilities(workspaceId: string): Promise<CapabilityDescriptor[]>;
  getHealth(): Promise<HealthStatus>;
  getFleetSnapshot(): Promise<FleetSnapshot>;

  uploadFile(input: UploadFileInput): Promise<FileRecord>;
  deleteFile(workspaceId: string, fileId: string): Promise<void>;
  archiveFile(workspaceId: string, fileId: string): Promise<void>;
  restoreFile(workspaceId: string, fileId: string): Promise<void>;
  retryJob(workspaceId: string, jobId: string): Promise<void>;
  runWorker(workspaceId: string): Promise<void>;
  createApiKey(input: CreateApiKeyInput): Promise<CreatedApiKey>;
  revokeApiKey(keyId: string): Promise<void>;
  revokeShare(workspaceId: string, shareId: string): Promise<void>;
}

export type DataMode = "demo" | "live";

export interface UploadFileInput {
  workspaceId: string;
  name: string;
  mimeType: string;
  data: string;
  dataEncoding: "utf8" | "base64";
  metadata?: Record<string, unknown>;
}

export interface CreateApiKeyInput {
  name: string;
  workspaceId: string | null;
  scopes?: string[];
  expiresInDays?: number | null;
}

export interface CreatedApiKey {
  apiKey: ApiKey;
  /** Returned exactly once at creation; never persisted in lists. */
  rawSecret: string;
}

export interface FleetWorkspaceRow {
  workspace: WorkspaceSummary;
  usedBytes: number;
  fileCount: number;
  activeR2Bytes: number;
  archivedDriveBytes: number;
  transitioningBytes: number;
  failedJobs: number;
  queuedJobs: number;
  lastActivityAt: string | null;
}

export interface FleetSnapshot {
  /** False when the backend exposes no owner-authorized aggregate endpoint. */
  available: boolean;
  reason?: string;
  observedAt: string;
  rows: FleetWorkspaceRow[];
}

export interface ApiErrorShape {
  status: number;
  message: string;
  code?: string;
}

export class OctoApiError extends Error implements ApiErrorShape {
  status: number;
  code?: string;

  constructor({ status, message, code }: ApiErrorShape) {
    super(message);
    this.name = "OctoApiError";
    this.status = status;
    this.code = code;
  }
}

export interface WorkspaceCapabilities {
  canManageMembers: boolean;
  canUploadFiles: boolean;
  canDeleteWorkspace: boolean;
  canManageSettings: boolean;
}

/** Derives role affordances from the returned role — never from the selector. */
export function capabilitiesFor(
  role: WorkspaceRole,
  isPlatformOwner: boolean,
): WorkspaceCapabilities {
  const elevated = role === "owner" || role === "admin";
  return {
    canManageMembers: elevated || isPlatformOwner,
    canUploadFiles: elevated || role === "operator" || isPlatformOwner,
    canDeleteWorkspace: role === "owner" || isPlatformOwner,
    canManageSettings: elevated || isPlatformOwner,
  };
}
