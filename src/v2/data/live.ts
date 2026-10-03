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
  type OctoApi,
  type UploadFileInput,
} from "./adapter";

const TOKEN_KEY = "octo_token";

/**
 * Adapter over the real Octo HTTP API.
 *
 * The browser only ever presents a session bearer token; authorization stays
 * server-side. A 401 clears the stored session so the shell returns to the
 * signed-out state instead of rendering an empty authenticated view.
 */
export class LiveOctoApi implements OctoApi {
  readonly mode = "live" as const;

  private token(): string | null {
    try {
      return window.localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = this.token();
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

    let response: Response;
    try {
      response = await fetch(path, { ...init, headers });
    } catch {
      throw new OctoApiError({
        status: 0,
        message: "Cannot reach the Octo server. Start it with `npm run server` or switch to Demo data.",
      });
    }

    if (response.status === 401) {
      try {
        window.localStorage.removeItem(TOKEN_KEY);
      } catch {
        /* ignore */
      }
      throw new OctoApiError({ status: 401, message: "Session expired. Sign in again." });
    }

    if (!response.ok) {
      let message = `Request failed (${response.status})`;
      let code: string | undefined;
      try {
        const body = (await response.json()) as { error?: string; message?: string; code?: string };
        message = body.error ?? body.message ?? message;
        code = body.code;
      } catch {
        /* non-JSON error body — keep the status text */
      }
      throw new OctoApiError({ status: response.status, message, code });
    }

    if (response.status === 204) return undefined as T;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return undefined as T;
    return (await response.json()) as T;
  }

  async getMe(): Promise<MeResponse> {
    return this.request<MeResponse>("/api/me");
  }

  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    return this.request<WorkspaceSummary[]>("/api/workspaces");
  }

  async listFiles(workspaceId: string): Promise<FileRecord[]> {
    return this.request<FileRecord[]>(`/api/files?workspaceId=${encodeURIComponent(workspaceId)}`);
  }

  async listGallery(workspaceId: string): Promise<GalleryItem[]> {
    return this.request<GalleryItem[]>(
      `/api/gallery?workspaceId=${encodeURIComponent(workspaceId)}`,
    );
  }

  async listJobs(workspaceId: string): Promise<JobRecord[]> {
    return this.request<JobRecord[]>(`/api/jobs?workspaceId=${encodeURIComponent(workspaceId)}`);
  }

  async listActivity(workspaceId: string): Promise<ActivityRecord[]> {
    return this.request<ActivityRecord[]>(
      `/api/activity?workspaceId=${encodeURIComponent(workspaceId)}`,
    );
  }

  async listKeys(): Promise<ApiKey[]> {
    return this.request<ApiKey[]>("/api/keys");
  }

  async listShares(workspaceId: string): Promise<ShareSummary[]> {
    return this.request<ShareSummary[]>(
      `/api/workspaces/shares?workspaceId=${encodeURIComponent(workspaceId)}`,
    );
  }

  async listCapabilities(workspaceId: string): Promise<CapabilityDescriptor[]> {
    return this.request<CapabilityDescriptor[]>(
      `/api/capabilities?workspaceId=${encodeURIComponent(workspaceId)}`,
    );
  }

  async getHealth(): Promise<HealthStatus> {
    const body = await this.request<Omit<HealthStatus, "observedAt">>("/health");
    return { ...body, observedAt: new Date().toISOString() };
  }

  /**
   * The brief is explicit: there is no owner-authorized fleet aggregate
   * endpoint yet, and a tenant client must not fan out to private endpoints to
   * invent one. Report the gap honestly instead of fabricating a total.
   */
  async getFleetSnapshot(): Promise<FleetSnapshot> {
    return {
      available: false,
      reason:
        "No owner-authorized fleet aggregate endpoint is implemented. Add GET /api/fleet/usage before this view can show live totals.",
      observedAt: new Date().toISOString(),
      rows: [],
    };
  }

  async uploadFile(input: UploadFileInput): Promise<FileRecord> {
    return this.request<FileRecord>("/api/files/upload", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async deleteFile(workspaceId: string, fileId: string): Promise<void> {
    await this.request<void>(
      `/api/files/${encodeURIComponent(fileId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
      { method: "DELETE" },
    );
  }

  async archiveFile(workspaceId: string, fileId: string): Promise<void> {
    await this.request<void>(
      `/api/files/${encodeURIComponent(fileId)}/archive?workspaceId=${encodeURIComponent(workspaceId)}`,
      { method: "POST" },
    );
  }

  async restoreFile(workspaceId: string, fileId: string): Promise<void> {
    await this.request<void>(
      `/api/files/${encodeURIComponent(fileId)}/restore?workspaceId=${encodeURIComponent(workspaceId)}`,
      { method: "POST" },
    );
  }

  async retryJob(workspaceId: string, jobId: string): Promise<void> {
    await this.request<void>(
      `/api/jobs/${encodeURIComponent(jobId)}/retry?workspaceId=${encodeURIComponent(workspaceId)}`,
      { method: "POST" },
    );
  }

  async runWorker(workspaceId: string): Promise<void> {
    await this.request<void>(
      `/api/jobs/run?workspaceId=${encodeURIComponent(workspaceId)}`,
      { method: "POST" },
    );
  }

  async createApiKey(input: CreateApiKeyInput): Promise<CreatedApiKey> {
    return this.request<CreatedApiKey>("/api/keys", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async revokeApiKey(keyId: string): Promise<void> {
    await this.request<void>(`/api/keys/${encodeURIComponent(keyId)}`, { method: "DELETE" });
  }

  async revokeShare(workspaceId: string, shareId: string): Promise<void> {
    await this.request<void>(
      `/api/shares/${encodeURIComponent(shareId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
      { method: "DELETE" },
    );
  }
}
