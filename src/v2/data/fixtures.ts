import type {
  ActivityRecord,
  ApiKey,
  CapabilityDescriptor,
  FileRecord,
  GalleryItem,
  HealthStatus,
  JobRecord,
  Principal,
  ShareSummary,
  WorkspaceSummary,
} from "@v2/types/octo";

/**
 * Deterministic demo fixtures.
 *
 * Everything here is illustrative. The UI is required to label fixture-derived
 * values as "Demo data" (see components/feedback.tsx) so a prototype can never
 * be mistaken for a connected deployment.
 */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Builds an offline-safe gradient poster so the gallery always renders. */
export function gradientPoster(seed: string, width = 960, height = 640): string {
  const hash = hashString(seed);
  const h1 = hash % 360;
  const h2 = (h1 + 35 + (hash % 70)) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="hsl(${h1} 58% 44%)"/><stop offset="1" stop-color="hsl(${h2} 62% 20%)"/>
</linearGradient></defs>
<rect width="${width}" height="${height}" fill="url(#g)"/>
<circle cx="${width * 0.72}" cy="${height * 0.28}" r="${Math.min(width, height) * 0.24}" fill="hsl(${h2} 72% 62%)" opacity="0.32"/>
<circle cx="${width * 0.28}" cy="${height * 0.76}" r="${Math.min(width, height) * 0.18}" fill="hsl(${h1} 82% 66%)" opacity="0.24"/>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);
const HOUR = 3600_000;
const DAY = 24 * HOUR;

function iso(msAgo: number): string {
  return new Date(NOW - msAgo).toISOString();
}

export const DEMO_PRINCIPAL: Principal = {
  id: "prn_01J8OWNER0000000000000000",
  authUserId: "auth_01J8OWNER0000000000000000",
  email: "owner@octo.local",
  displayName: "Pujan",
  avatarUrl: null,
  isPlatformOwner: true,
  isGuest: false,
  createdAt: iso(90 * DAY),
  updatedAt: iso(2 * HOUR),
};

export const DEMO_WORKSPACES: WorkspaceSummary[] = [
  {
    id: "ws_personal",
    slug: "personal",
    name: "Personal",
    description: "Notes, documents, and day-to-day files.",
    role: "owner",
    isOwner: true,
    retentionDays: 365,
  },
  {
    id: "ws_media",
    slug: "family-media",
    name: "Family Media",
    description: "Photos and video archived to cold storage.",
    role: "owner",
    isOwner: true,
    retentionDays: 1825,
  },
  {
    id: "ws_research",
    slug: "research",
    name: "Research",
    description: "Papers, datasets, and experimental outputs.",
    role: "admin",
    isOwner: false,
    retentionDays: null,
  },
  {
    id: "ws_agents",
    slug: "agent-sandbox",
    name: "Agent Sandbox",
    description: "Scratch workspace for scoped machine identities.",
    role: "operator",
    isOwner: false,
    retentionDays: 30,
  },
  {
    id: "ws_archive",
    slug: "long-term-archive",
    name: "Long-Term Archive",
    description: "Write-once records retained for compliance.",
    role: "member",
    isOwner: false,
    retentionDays: 3650,
  },
];

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  mp4: "video/mp4",
  csv: "text/csv",
  json: "application/json",
  md: "text/markdown",
  parquet: "application/vnd.apache.parquet",
  zip: "application/zip",
};

const FILE_STEMS = [
  "quarterly-report",
  "design-system-spec",
  "onboarding-checklist",
  "storage-cost-model",
  "incident-postmortem",
  "vector-index-snapshot",
  "ingest-manifest",
  "retention-policy",
  "agent-proposal-log",
  "cold-tier-audit",
  "workspace-export",
  "schema-migration",
  "backup-verification",
  "usage-rollup",
  "thumbnail-cache",
  "share-link-inventory",
  "job-queue-sample",
  "provider-credentials-audit",
  "graph-projection",
  "analytics-parquet-dump",
  "media-album-index",
  "restore-drill-log",
  "key-rotation-record",
  "gallery-metadata",
  "archive-transition-log",
  "cold-storage-receipt",
];

const ARCHIVE_STATES = [
  "active_r2",
  "active_r2",
  "active_r2",
  "archived_drive",
  "archiving",
  "restoring",
] as const;

function extensionFor(index: number): string {
  const extensions = ["pdf", "png", "csv", "json", "md", "parquet", "jpg", "zip", "mp4", "webp"];
  return extensions[index % extensions.length]!;
}

export function buildDemoFiles(workspaceId: string, count: number, seedOffset = 0): FileRecord[] {
  const random = mulberry32(hashString(workspaceId) + seedOffset);
  const files: FileRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    const stem = FILE_STEMS[(index * 3 + seedOffset) % FILE_STEMS.length]!;
    const extension = extensionFor(index + seedOffset);
    const name = `${stem}-${(index % 9) + 1}.${extension}`;
    const mimeType = MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
    const sizeBytes = Math.round(
      (extension === "mp4"
        ? 40 * 1024 * 1024
        : extension === "parquet"
          ? 8 * 1024 * 1024
          : 220 * 1024) *
        (0.35 + random() * 3.4),
    );
    const archiveState = ARCHIVE_STATES[Math.floor(random() * ARCHIVE_STATES.length)]!;
    const createdAt = iso(Math.floor(random() * 120) * DAY + index * HOUR);
    files.push({
      id: `file_${workspaceId}_${index.toString().padStart(3, "0")}`,
      workspaceId,
      createdBy: DEMO_PRINCIPAL.id,
      name,
      mimeType,
      sizeBytes,
      provider: archiveState === "archived_drive" ? "google-drive" : "cloudflare-r2",
      storageKey: `octo/${workspaceId}/${name}`,
      status: "active",
      contentHash: `sha256:${hashString(name).toString(16).padStart(8, "0")}`,
      archiveState,
      metadata: { source: "demo-fixture" },
      createdAt,
      updatedAt: createdAt,
    });
  }
  return files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const MEDIA_STEMS = [
  "sunset-ridge",
  "harbor-lights",
  "studio-session",
  "trailhead",
  "kitchen-table",
  "rooftop-golden-hour",
  "coastline-drone",
  "workshop-desk",
  "night-market",
  "garden-morning",
  "conference-hall",
  "snowline",
];

export function buildDemoGallery(workspaceId: string, count: number): GalleryItem[] {
  const random = mulberry32(hashString(`gallery:${workspaceId}`));
  const items: GalleryItem[] = [];
  for (let index = 0; index < count; index += 1) {
    const isVideo = index % 5 === 4;
    const stem = MEDIA_STEMS[index % MEDIA_STEMS.length]!;
    const extension = isVideo ? "mp4" : index % 3 === 0 ? "webp" : "jpg";
    const name = `${stem}.${extension}`;
    const poster = gradientPoster(name, isVideo ? 1280 : 960, isVideo ? 720 : 640);
    items.push({
      id: `media_${workspaceId}_${index.toString().padStart(3, "0")}`,
      workspaceId,
      name,
      mimeType: isVideo ? "video/mp4" : extension === "webp" ? "image/webp" : "image/jpeg",
      sizeBytes: Math.round((isVideo ? 90 : 3.4) * 1024 * 1024 * (0.5 + random())),
      kind: isVideo ? "video" : "image",
      storageKey: `octo/${workspaceId}/media/${name}`,
      thumbnailUrl: gradientPoster(`thumb:${name}`, 480, 360),
      fullUrl: poster,
      createdAt: iso(Math.floor(random() * 90) * DAY),
    });
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const JOB_TYPES = [
  "archive_file",
  "restore_file",
  "generate_thumbnail",
  "retention_sweep",
  "reconcile_tier",
  "ingest_manifest",
];

const ERROR_SUMMARIES = [
  "Provider returned 503 after 3 attempts",
  "Signed URL expired before read completed",
  "Object not found in cold tier during transition",
  "Checksum mismatch between R2 and catalog record",
];

export function buildDemoJobs(workspaceId: string, count: number): JobRecord[] {
  const random = mulberry32(hashString(`jobs:${workspaceId}`));
  const jobs: JobRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    const roll = random();
    const state: JobRecord["state"] =
      roll > 0.78 ? "failed" : roll > 0.58 ? "running" : roll > 0.42 ? "queued" : "completed";
    const jobType = JOB_TYPES[Math.floor(random() * JOB_TYPES.length)]!;
    const createdAt = iso(Math.floor(random() * 20) * HOUR + index * 7 * 60_000);
    const attempt = state === "failed" ? 3 : state === "completed" ? 1 : random() > 0.6 ? 2 : 1;
    jobs.push({
      id: `job_${workspaceId}_${index.toString().padStart(3, "0")}`,
      workspaceId,
      jobType,
      state,
      idempotencyKey: `${jobType}:${index}`,
      attempt,
      maxAttempts: 3,
      availableAt: createdAt,
      leaseExpiresAt: state === "running" ? iso(-5 * 60_000) : null,
      payload: { fileId: `file_${workspaceId}_${index.toString().padStart(3, "0")}` },
      result: state === "completed" ? { ok: true } : null,
      errorCode: state === "failed" ? "provider_unavailable" : null,
      errorSummary:
        state === "failed" ? ERROR_SUMMARIES[Math.floor(random() * ERROR_SUMMARIES.length)]! : null,
      completedAt: state === "completed" ? iso(Math.floor(random() * 18) * HOUR) : null,
      createdAt,
      updatedAt: createdAt,
    });
  }
  return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const ACTIVITY_EVENTS: Array<[string, string]> = [
  ["file.uploaded", "uploaded {file} to active storage"],
  ["file.archived", "archived {file} to cold storage"],
  ["file.restored", "restored {file} from cold storage"],
  ["file.deleted", "removed {file} from the catalog"],
  ["job.retried", "retried a failed archive job"],
  ["key.created", "issued a workspace-scoped API key"],
  ["key.revoked", "revoked an API key"],
  ["share.created", "created a read-only gallery share link"],
  ["share.revoked", "revoked a gallery share link"],
  ["workspace.updated", "updated workspace retention policy"],
];

export function buildDemoActivity(workspaceId: string, count: number): ActivityRecord[] {
  const random = mulberry32(hashString(`activity:${workspaceId}`));
  const rows: ActivityRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    const [eventType, template] = ACTIVITY_EVENTS[Math.floor(random() * ACTIVITY_EVENTS.length)]!;
    const stem = FILE_STEMS[(index * 5) % FILE_STEMS.length]!;
    rows.push({
      id: `act_${workspaceId}_${index.toString().padStart(3, "0")}`,
      eventType,
      summary: template.replace("{file}", `${stem}.pdf`),
      jobId: eventType.startsWith("file.") ? `job_${workspaceId}_${index % 6}` : null,
      createdAt: iso(Math.floor(random() * 30) * HOUR + index * 11 * 60_000),
    });
  }
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const DEMO_KEYS: ApiKey[] = [
  {
    id: "key_account_wide",
    prefix: "octo_acct_7f2a",
    name: "Account-wide automation",
    principalId: DEMO_PRINCIPAL.id,
    workspaceId: null,
    role: null,
    scopes: ["*"],
    expiresAt: null,
    createdAt: iso(60 * DAY),
    lastUsedAt: iso(3 * HOUR),
    isAccountWide: true,
  },
  {
    id: "key_media_ingest",
    prefix: "octo_ws_19bd",
    name: "Media ingest",
    principalId: DEMO_PRINCIPAL.id,
    workspaceId: "ws_media",
    role: "operator",
    scopes: ["files:read", "files:write", "jobs:run"],
    expiresAt: iso(-120 * DAY),
    createdAt: iso(20 * DAY),
    lastUsedAt: iso(2 * DAY),
    isAccountWide: false,
  },
  {
    id: "key_research_read",
    prefix: "octo_ws_44c1",
    name: "Research read-only",
    principalId: DEMO_PRINCIPAL.id,
    workspaceId: "ws_research",
    role: "member",
    scopes: ["files:read", "activity:read"],
    expiresAt: null,
    createdAt: iso(9 * DAY),
    lastUsedAt: null,
    isAccountWide: false,
  },
];

export const DEMO_SHARES: ShareSummary[] = [
  {
    id: "share_album_spring",
    workspaceId: "ws_media",
    resourceType: "gallery",
    permission: "read",
    validUntil: iso(-14 * DAY),
    revokedAt: null,
    createdAt: iso(6 * DAY),
    active: true,
  },
  {
    id: "share_album_expired",
    workspaceId: "ws_media",
    resourceType: "gallery",
    permission: "read",
    validUntil: iso(4 * DAY),
    revokedAt: null,
    createdAt: iso(20 * DAY),
    active: false,
  },
  {
    id: "share_revoked",
    workspaceId: "ws_personal",
    resourceType: "gallery",
    permission: "read",
    validUntil: null,
    revokedAt: iso(3 * DAY),
    createdAt: iso(12 * DAY),
    active: false,
  },
];

export const DEMO_CAPABILITIES: CapabilityDescriptor[] = [
  {
    id: "files.list",
    label: "List files",
    description: "Read the workspace file catalog.",
    method: "GET",
    path: "/api/files?workspaceId=:id",
    scope: "files:read",
    available: true,
  },
  {
    id: "files.upload",
    label: "Upload file",
    description: "Store a new file in active storage.",
    method: "POST",
    path: "/api/files/upload",
    scope: "files:write",
    available: true,
  },
  {
    id: "files.archive",
    label: "Archive file",
    description: "Transition a file from active storage to cold storage.",
    method: "POST",
    path: "/api/files/:fileId/archive",
    scope: "files:write",
    available: true,
  },
  {
    id: "files.restore",
    label: "Restore file",
    description: "Restore a file from cold storage back to active storage.",
    method: "POST",
    path: "/api/files/:fileId/restore",
    scope: "files:write",
    available: true,
  },
  {
    id: "gallery.list",
    label: "Browse gallery",
    description: "List media with signed thumbnail and full-size URLs.",
    method: "GET",
    path: "/api/gallery?workspaceId=:id",
    scope: "files:read",
    available: true,
  },
  {
    id: "jobs.list",
    label: "Review jobs",
    description: "Read recent background jobs for the workspace.",
    method: "GET",
    path: "/api/jobs?workspaceId=:id",
    scope: "jobs:read",
    available: true,
  },
  {
    id: "jobs.retry",
    label: "Retry job",
    description: "Re-enqueue a failed background job.",
    method: "POST",
    path: "/api/jobs/:jobId/retry",
    scope: "jobs:run",
    available: true,
  },
  {
    id: "activity.list",
    label: "Read activity",
    description: "Read the workspace activity feed.",
    method: "GET",
    path: "/api/activity?workspaceId=:id",
    scope: "activity:read",
    available: true,
  },
  {
    id: "keys.list",
    label: "List API keys",
    description: "Read the authenticated principal's API keys.",
    method: "GET",
    path: "/api/keys",
    scope: null,
    available: true,
  },
  {
    id: "usage.storage",
    label: "Workspace storage usage",
    description: "Aggregate catalog usage for one workspace.",
    method: "GET",
    path: "/api/workspaces/:id/usage/storage",
    scope: null,
    available: false,
  },
  {
    id: "fleet.usage",
    label: "Fleet usage summary",
    description: "Owner-authorized aggregate across all authorized workspaces.",
    method: "GET",
    path: "/api/fleet/usage",
    scope: null,
    available: false,
  },
];

export const DEMO_HEALTH: Omit<HealthStatus, "observedAt"> = {
  status: "ok",
  version: "0.1.0-demo",
  database: { connected: true, version: "PostgreSQL 16.4" },
  r2: { connected: true, bucket: "octo" },
  googleAuthEnabled: true,
};

/** Retention days a workspace declares, used for the honest "policy" display. */
export function demoRetention(workspaceId: string): number | null {
  return DEMO_WORKSPACES.find((workspace) => workspace.id === workspaceId)?.retentionDays ?? null;
}
