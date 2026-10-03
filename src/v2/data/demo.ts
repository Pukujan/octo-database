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
  WorkspaceSummary,
} from "@v2/types/octo";
import {
  OctoApiError,
  type CreateApiKeyInput,
  type CreatedApiKey,
  type FleetSnapshot,
  type FleetWorkspaceRow,
  type OctoApi,
  type UploadFileInput,
} from "./adapter";
import {
  DEMO_CAPABILITIES,
  DEMO_HEALTH,
  DEMO_KEYS,
  DEMO_PRINCIPAL,
  DEMO_SHARES,
  DEMO_WORKSPACES,
  buildDemoActivity,
  buildDemoFiles,
  buildDemoGallery,
  buildDemoJobs,
} from "./fixtures";

const FILE_COUNTS: Record<string, number> = {
  ws_personal: 18,
  ws_media: 26,
  ws_research: 14,
  ws_agents: 9,
  ws_archive: 22,
};

const GALLERY_COUNTS: Record<string, number> = {
  ws_personal: 4,
  ws_media: 12,
  ws_research: 2,
  ws_agents: 0,
  ws_archive: 0,
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * In-memory adapter backed by deterministic fixtures.
 *
 * Mutations are real: archiving, restoring, deleting, retrying and key
 * creation all change the adapter's state, so the UI behaves like a connected
 * client while remaining entirely offline.
 */
export class DemoOctoApi implements OctoApi {
  readonly mode = "demo" as const;

  private workspaces: WorkspaceSummary[] = clone(DEMO_WORKSPACES);
  private files = new Map<string, FileRecord[]>();
  private jobs = new Map<string, JobRecord[]>();
  private activity = new Map<string, ActivityRecord[]>();
  private gallery = new Map<string, GalleryItem[]>();
  private keys: ApiKey[] = clone(DEMO_KEYS);
  private shares: ShareSummary[] = clone(DEMO_SHARES);
  private counter = 0;

  constructor() {
    for (const workspace of this.workspaces) {
      this.files.set(workspace.id, buildDemoFiles(workspace.id, FILE_COUNTS[workspace.id] ?? 10));
      this.jobs.set(workspace.id, buildDemoJobs(workspace.id, 12));
      this.activity.set(workspace.id, buildDemoActivity(workspace.id, 16));
      this.gallery.set(workspace.id, buildDemoGallery(workspace.id, GALLERY_COUNTS[workspace.id] ?? 0));
    }
  }

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}_${Date.now().toString(36)}${this.counter}`;
  }

  private filesOf(workspaceId: string): FileRecord[] {
    const rows = this.files.get(workspaceId);
    if (!rows) throw new OctoApiError({ status: 404, message: "Workspace not found" });
    return rows;
  }

  private jobsOf(workspaceId: string): JobRecord[] {
    return this.jobs.get(workspaceId) ?? [];
  }

  private activityOf(workspaceId: string): ActivityRecord[] {
    return this.activity.get(workspaceId) ?? [];
  }

  private record(
    workspaceId: string,
    eventType: string,
    summary: string,
    jobId: string | null = null,
  ): void {
    const rows = this.activity.get(workspaceId) ?? [];
    rows.unshift({
      id: this.nextId("act"),
      eventType,
      summary,
      jobId,
      createdAt: new Date().toISOString(),
    });
    this.activity.set(workspaceId, rows);
  }

  private enqueue(workspaceId: string, jobType: string, state: JobRecord["state"]): JobRecord {
    const rows = this.jobs.get(workspaceId) ?? [];
    const now = new Date().toISOString();
    const job: JobRecord = {
      id: this.nextId("job"),
      workspaceId,
      jobType,
      state,
      idempotencyKey: `${jobType}:${now}`,
      attempt: state === "completed" ? 1 : 0,
      maxAttempts: 3,
      availableAt: now,
      leaseExpiresAt: null,
      payload: {},
      result: state === "completed" ? { ok: true } : null,
      errorCode: null,
      errorSummary: null,
      completedAt: state === "completed" ? now : null,
      createdAt: now,
      updatedAt: now,
    };
    rows.unshift(job);
    this.jobs.set(workspaceId, rows);
    return job;
  }

  async getMe(): Promise<MeResponse> {
    return { principal: clone(DEMO_PRINCIPAL), apiKey: null, confirmSecretSet: true };
  }

  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    return clone(this.workspaces);
  }

  async listFiles(workspaceId: string): Promise<FileRecord[]> {
    return clone(this.filesOf(workspaceId));
  }

  async listGallery(workspaceId: string): Promise<GalleryItem[]> {
    return clone(this.gallery.get(workspaceId) ?? []);
  }

  async listJobs(workspaceId: string): Promise<JobRecord[]> {
    return clone(this.jobsOf(workspaceId));
  }

  async listActivity(workspaceId: string): Promise<ActivityRecord[]> {
    return clone(this.activityOf(workspaceId));
  }

  async listKeys(): Promise<ApiKey[]> {
    return clone(this.keys);
  }

  async listShares(workspaceId: string): Promise<ShareSummary[]> {
    return clone(this.shares.filter((share) => share.workspaceId === workspaceId));
  }

  async listCapabilities(_workspaceId: string): Promise<CapabilityDescriptor[]> {
    return clone(DEMO_CAPABILITIES);
  }

  async getHealth(): Promise<HealthStatus> {
    return { ...clone(DEMO_HEALTH), observedAt: new Date().toISOString() };
  }

  async getFleetSnapshot(): Promise<FleetSnapshot> {
    const rows: FleetWorkspaceRow[] = this.workspaces.map((workspace) => {
      const files = this.filesOf(workspace.id);
      const jobs = this.jobsOf(workspace.id);
      const activity = this.activityOf(workspace.id);
      let activeR2Bytes = 0;
      let archivedDriveBytes = 0;
      let transitioningBytes = 0;
      for (const file of files) {
        if (file.archiveState === "archived_drive") archivedDriveBytes += file.sizeBytes;
        else if (file.archiveState === "archiving" || file.archiveState === "restoring")
          transitioningBytes += file.sizeBytes;
        else activeR2Bytes += file.sizeBytes;
      }
      return {
        workspace,
        usedBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
        fileCount: files.length,
        activeR2Bytes,
        archivedDriveBytes,
        transitioningBytes,
        failedJobs: jobs.filter((job) => job.state === "failed").length,
        queuedJobs: jobs.filter((job) => job.state === "queued" || job.state === "running").length,
        lastActivityAt: activity[0]?.createdAt ?? null,
      };
    });

    return {
      available: true,
      observedAt: new Date().toISOString(),
      rows: rows.sort((a, b) => b.usedBytes - a.usedBytes),
    };
  }

  async uploadFile(input: UploadFileInput): Promise<FileRecord> {
    const sizeBytes =
      input.dataEncoding === "base64"
        ? Math.floor((input.data.length * 3) / 4)
        : new TextEncoder().encode(input.data).length;
    const now = new Date().toISOString();
    const record: FileRecord = {
      id: this.nextId("file"),
      workspaceId: input.workspaceId,
      createdBy: DEMO_PRINCIPAL.id,
      name: input.name,
      mimeType: input.mimeType,
      sizeBytes,
      provider: "cloudflare-r2",
      storageKey: `octo/${input.workspaceId}/${input.name}`,
      status: "active",
      contentHash: `sha256:${sizeBytes.toString(16)}`,
      archiveState: "active_r2",
      metadata: input.metadata ?? { source: "upload" },
      createdAt: now,
      updatedAt: now,
    };
    this.filesOf(input.workspaceId).unshift(record);

    if (input.mimeType.startsWith("image/") || input.mimeType.startsWith("video/")) {
      const media = this.gallery.get(input.workspaceId) ?? [];
      media.unshift({
        id: record.id,
        workspaceId: input.workspaceId,
        name: input.name,
        mimeType: input.mimeType,
        sizeBytes,
        kind: input.mimeType.startsWith("video/") ? "video" : "image",
        storageKey: record.storageKey,
        thumbnailUrl: `data:image/svg+xml;utf8,${encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="hsl(228 14% 12%)"/><text x="24" y="188" fill="hsl(80 74% 68%)" font-family="Inter, sans-serif" font-size="20">${input.name.slice(0, 24)}</text></svg>`,
        )}`,
        fullUrl: `data:image/svg+xml;utf8,${encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640"><rect width="960" height="640" fill="hsl(228 14% 10%)"/><text x="40" y="330" fill="hsl(80 74% 68%)" font-family="Inter, sans-serif" font-size="34">${input.name.slice(0, 30)}</text></svg>`,
        )}`,
        createdAt: now,
      });
      this.gallery.set(input.workspaceId, media);
    }

    this.record(input.workspaceId, "file.uploaded", `uploaded ${input.name} to active storage`);
    return clone(record);
  }

  async deleteFile(workspaceId: string, fileId: string): Promise<void> {
    const rows = this.filesOf(workspaceId);
    const target = rows.find((file) => file.id === fileId);
    this.files.set(
      workspaceId,
      rows.filter((file) => file.id !== fileId),
    );
    this.gallery.set(
      workspaceId,
      (this.gallery.get(workspaceId) ?? []).filter((item) => item.id !== fileId),
    );
    if (target) this.record(workspaceId, "file.deleted", `removed ${target.name} from the catalog`);
  }

  private transition(workspaceId: string, fileId: string, to: "archived_drive" | "active_r2"): void {
    const rows = this.filesOf(workspaceId);
    const target = rows.find((file) => file.id === fileId);
    if (!target) throw new OctoApiError({ status: 404, message: "File not found" });
    target.archiveState = to;
    target.provider = to === "archived_drive" ? "google-drive" : "cloudflare-r2";
    target.updatedAt = new Date().toISOString();

    if (to === "archived_drive") {
      const job = this.enqueue(workspaceId, "archive_file", "completed");
      this.record(workspaceId, "file.archived", `archived ${target.name} to cold storage`, job.id);
    } else {
      const job = this.enqueue(workspaceId, "restore_file", "completed");
      this.record(workspaceId, "file.restored", `restored ${target.name} from cold storage`, job.id);
    }
  }

  async archiveFile(workspaceId: string, fileId: string): Promise<void> {
    this.transition(workspaceId, fileId, "archived_drive");
  }

  async restoreFile(workspaceId: string, fileId: string): Promise<void> {
    this.transition(workspaceId, fileId, "active_r2");
  }

  async retryJob(workspaceId: string, jobId: string): Promise<void> {
    const job = this.jobsOf(workspaceId).find((candidate) => candidate.id === jobId);
    if (!job) throw new OctoApiError({ status: 404, message: "Job not found" });
    job.state = "queued";
    job.attempt = 0;
    job.errorCode = null;
    job.errorSummary = null;
    job.updatedAt = new Date().toISOString();
    this.record(workspaceId, "job.retried", `retried a failed ${job.jobType} job`, job.id);
  }

  async runWorker(workspaceId: string): Promise<void> {
    const rows = this.jobsOf(workspaceId);
    let processed = 0;
    for (const job of rows) {
      if (job.state === "queued" || job.state === "running") {
        job.state = "completed";
        job.attempt += 1;
        job.completedAt = new Date().toISOString();
        job.updatedAt = job.completedAt;
        processed += 1;
      }
    }
    if (processed > 0) {
      this.record(workspaceId, "job.retried", `worker pass completed ${processed} job(s)`);
    }
  }

  async createApiKey(input: CreateApiKeyInput): Promise<CreatedApiKey> {
    const now = new Date().toISOString();
    const prefix = `octo_${input.workspaceId ? "ws" : "acct"}_${Math.random()
      .toString(16)
      .slice(2, 6)}`;
    const apiKey: ApiKey = {
      id: this.nextId("key"),
      prefix,
      name: input.name,
      principalId: DEMO_PRINCIPAL.id,
      workspaceId: input.workspaceId,
      role: input.workspaceId
        ? (this.workspaces.find((workspace) => workspace.id === input.workspaceId)?.role ?? "member")
        : null,
      scopes: input.scopes && input.scopes.length > 0 ? input.scopes : ["files:read"],
      expiresAt:
        input.expiresInDays && input.expiresInDays > 0
          ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString()
          : null,
      createdAt: now,
      lastUsedAt: null,
      isAccountWide: !input.workspaceId,
    };
    this.keys.unshift(apiKey);
    if (input.workspaceId) {
      this.record(input.workspaceId, "key.created", `issued the API key "${input.name}"`);
    }
    return { apiKey: clone(apiKey), rawSecret: `${prefix}_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}` };
  }

  async revokeApiKey(keyId: string): Promise<void> {
    const target = this.keys.find((key) => key.id === keyId);
    this.keys = this.keys.filter((key) => key.id !== keyId);
    if (target?.workspaceId) {
      this.record(target.workspaceId, "key.revoked", `revoked the API key "${target.name}"`);
    }
  }

  async revokeShare(workspaceId: string, shareId: string): Promise<void> {
    const share = this.shares.find((candidate) => candidate.id === shareId);
    if (!share) throw new OctoApiError({ status: 404, message: "Share not found" });
    share.revokedAt = new Date().toISOString();
    share.active = false;
    this.record(workspaceId, "share.revoked", "revoked a gallery share link");
  }
}
