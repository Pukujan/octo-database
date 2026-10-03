# Octo Dashboard Prototype Brief for Dyad

**Purpose:** Give Dyad one source-grounded brief for a usable Octo dashboard prototype, including the user jobs, current API surface, stable domain shapes, and the data Octo does not collect yet.

**Status:** Design/prototype input only. Existing API details below describe the implementation on `main` when this brief was written. Quota and telemetry contracts are proposals, not deployed endpoints. This document does not authorize backend or production changes.

## Paste-ready Dyad request

> Build a polished, responsive Octo workspace and operations dashboard from a clean slate. Octo is a multi-tenant workspace data platform. Use Supabase's dashboard as a visual reference for strong navigation, useful information density, clear tables, and well-designed charts; keep Octo's own identity and workspace jobs rather than copying Supabase branding or its infrastructure controls. Use the existing Octo product jobs and API contract in `docs/frontend/DYAD_DASHBOARD_BRIEF.md`.
>
> Make the platform-owner view and tenant workspace view visibly distinct. A tenant user may browse only workspaces returned for their authenticated identity; within a workspace show its role, files, recorded storage use, jobs, and recent activity. The platform owner may compare authorized workspaces in a fleet view and drill into one workspace. A platform-owner identity is not itself a larger storage plan or quota.
>
> Use dark mode as the default and keep the visual system interchangeable. Choose any frontend framework, libraries, design tools, and visual approach that best serve the result; do not assume the current frontend stack is a requirement. Include the Octo workspace jobs described below, and use charts only where trustworthy time-series data exists.
>
> Use current Octo types and endpoints when available. Do not invent a live quota, remaining bucket capacity, API latency, throughput, uptime history, or storage trend. For the visual prototype, any illustrative sample values must carry a visible “Demo data” label and must be kept in replaceable fixtures. For unsupported metrics use an honest state such as “Quota not configured” or “Telemetry not collected”. Do not show those values as zero or unlimited.
>
> Keep the prototype’s data adapter separate from page components. Do not change Octo’s server, authorization rules, database schema, provider configuration, or deployment. Do not recreate deep database, billing, identity-provider, bucket, or infrastructure administration; those remain in their native consoles. Return the clickable prototype and a short list of API gaps it exposed.

## Users and workspace boundaries

Octo has two different notions of ownership. Keep them separate in labels and logic:

| Identity/context | Meaning | Dashboard treatment |
| --- | --- | --- |
| Platform owner (`Principal.isPlatformOwner`) | Octo-wide operator authority. | Owner fleet view can compare the workspaces the authenticated API returns. It does not imply a larger user quota. |
| Workspace owner (`WorkspaceSummary.role === 'owner'`) | Owner role inside one workspace. | Show workspace-level actions allowed to that role. It is not the same as the platform owner. |
| Workspace member (`admin`, `operator`, or `member`) | Membership in a particular workspace. | Scope records and actions to selected, authorized workspace(s); use the returned role for affordances and let the API enforce each action. |

**Recommended quota unit for discussion:** a workspace/tenant. Members of the same workspace share its usage because the file catalog is keyed by `workspaceId`. `FileRecord.createdBy` identifies the uploader; it is not an individual storage allocation. The platform owner may compare workspace totals, but any owner-specific quota exception requires an explicit product rule and an API value. Neither exists today.

Do not treat a workspace selector as permission. Use the authenticated `/api/workspaces` response, and handle `401`/`403` by clearing or refreshing the view. Never derive cross-tenant access in the browser.

## Dashboard jobs and required views

### 1. Workspace Overview

Answer, for the selected workspace:

- Which workspace am I in, and what is my role there?
- How much file data is recorded in its catalog, and how is it split between active R2 and archived Drive records?
- Are background jobs queued, running, failed, or recently completed?
- What was the latest workspace activity, and what can my role do next?

Show the measurement label next to catalog-derived file usage. Do not call it physical bucket usage or remaining provider capacity.

### 2. Platform-owner Fleet Overview

Answer:

- How many authorized workspaces are visible to the platform owner?
- Which workspaces have the most catalog-recorded storage or failed jobs?
- Which workspace needs attention, and can I drill into it?

The existing API has no fleet usage summary or member counts. A Dyad mock may illustrate the layout, but its fixture must be conspicuously marked as demo. A connected version needs an owner-authorized aggregate endpoint; do not fan out from the browser to private tenant endpoints or infer a fleet total from one selected workspace.

### 3. Storage and allocation

For each workspace, show catalog bytes and file count, split by `archiveState` when the record provides it. Use a simple stacked bar or compact table for the present-day snapshot. Do not show a quota gauge until `limitBytes` is configured and returned by the API.

For the owner fleet view, compare workspaces side by side. Do not sum all files uploaded by a person and describe that as their personal allowance. If a future policy decides limits attach to principals, that requires a separate explicit allocation rule and matching backend contract.

### 4. Operations and service status

Show the current job queue by state, retry attempts and failure summary, plus recent activity. Present queue counts and lists from the selected workspace’s records. Existing job timestamps support job age and completion age only; they do not separate queue wait from execution time.

`GET /health` provides a point-in-time service check for PostgreSQL/R2 connectivity and the configured database/R2 labels. It is not a time-series source, tenant metric, or uptime guarantee. Keep platform connectivity secondary to the user’s workspace work.

### 5. Files, Gallery, and Access

Keep Octo’s existing user jobs available in the prototype: browse and search files, inspect size and archive state, upload/download/archive/restore where allowed, preview actual media in Gallery, inspect jobs, and manage the visible API keys/share links. Do not invent membership-management routes or new permissions. Reuse actual Octo actions and show a clear error state when one is refused.

## Metrics: what is real now vs. what needs a contract

| Metric | Can Octo show it today? | Definition / limitation | Prototype treatment |
| --- | --- | --- | --- |
| Catalog-recorded bytes per workspace | **Yes, as an estimate** | Sum `FileRecord.sizeBytes` for returned, non-deleted workspace file records. This is metadata accounting, not an R2 bill or provider bucket inventory. | Show “Recorded file usage”; indicate the selected workspace and data refresh time if available. |
| File count and active/archive split | **Yes, as an estimate** | Count catalog records, classifying by `archiveState` (`active_r2`, `archived_drive`, or a transient/unknown state). Avoid double counting a file during transitions. | Small stacked bar/table; include “transitioning” separately. |
| Configured storage quota / bytes remaining | **No** | No workspace/principal quota, entitlement, or enforcement exists. `retentionDays` is an archive policy, not a storage limit. The R2 health flag is not remaining bucket capacity. | “Quota not configured”; never show zero, unlimited, a percentage, or a made-up owner exception. |
| Historical storage growth | **No reliable series** | Current file `createdAt` values are not retained aggregate samples; deleting catalog rows can remove history. | “Trend not collected.” Use clearly marked demo fixture only in a non-connected prototype. |
| Jobs by state / current failure list | **Yes, bounded** | `/api/jobs` returns recent workspace jobs (up to 50). States include queued/running/completed/failed/paused; attempts and timestamps are present. | State counts and failure table. Label the recent window if displayed. |
| Queue wait vs. job execution duration | **No** | Current public/UI fields do not record a stable `startedAt` and distinct queue/processing intervals. `createdAt`→`completedAt` is only an end-to-end elapsed age. | Do not label elapsed age as processing speed. |
| API latency, request rate, error rate, upload/download throughput | **No** | No request instrumentation or retained time-series exists in the current app contract. | “Telemetry not collected”; propose a chart only as demo data. |
| Database/R2 connected | **Yes, point in time** | `/health` returns current connection booleans and provider labels. | Compact service status, with observation time if the client records when it fetched it. |

Useful future charts, after the data exists: workspace storage used against a configured workspace quota; active-R2 versus archived-Drive bytes; 7/30-day storage change from retained samples; job queue depth and completion/error counts over time; and API p50/p95 latency plus error rate. A chart without a defined source, time window, unit, and aggregation is not a metric.

## Current API surface for the prototype

The browser calls the same-origin API with `Authorization: Bearer <sessionToken>`. The server remains the authority for authentication, membership, workspace binding, scopes, and role checks. Most errors are JSON objects with an `error` string; the capabilities route also includes `code` and `message`. Existing routes do not yet share a generated OpenAPI schema or one versioned response-envelope type.

| User job | Existing endpoint | Current response / note |
| --- | --- | --- |
| Resolve current identity | `GET /api/me` | `{ principal, apiKey, confirmSecretSet }`; `apiKey` may be `null`. |
| List authorized workspaces | `GET /api/workspaces` | `WorkspaceSummary[]`; an account-wide/platform-owner session can have broader visibility than a workspace-bound key. Use returned rows only. |
| List a workspace’s catalog files | `GET /api/files?workspaceId=<id>` | `FileRecord[]` for that workspace’s active catalog rows, including archive state. Requires workspace authorization and the files scope for keys. |
| Browse media | `GET /api/gallery?workspaceId=<id>` | Media rows with `id`, `name`, `mimeType`, `sizeBytes`, `kind`, signed `thumbnailUrl`/`fullUrl`, and `createdAt`. URLs can expire. |
| Review queue | `GET /api/jobs?workspaceId=<id>` | Recent `JobRecord[]`, newest first; server currently returns up to 50. |
| Review activity | `GET /api/activity?workspaceId=<id>` | Recent rows (`id`, `eventType`, `summary`, `jobId`, `createdAt`), newest first; server currently returns up to 50. The UI DTO omits `jobId`. |
| Inspect API keys | `GET /api/keys` | `ApiKey[]` for the authenticated principal. The raw key secret is returned only once during creation, not by list. |
| Inspect callable surface | `GET /api/capabilities?workspaceId=<id>` | Capability descriptors filtered for the credential and requested workspace. Treat as affordance guidance; each operation still enforces authorization server-side. |
| Check service connectivity | `GET /health` | `{ status, version, database: { connected, version }, r2: { connected, bucket }, googleAuthEnabled }`; service-level, not tenant-level. |

Current mutation endpoints the current Octo client uses include `POST /api/files/upload`, `GET /api/files/content?workspaceId=&fileId=`, `DELETE /api/files/<fileId>?workspaceId=`, `POST /api/files/<fileId>/archive|restore?workspaceId=`, `POST /api/jobs/<jobId>/retry?workspaceId=`, `POST /api/jobs/run?workspaceId=`, and key/share mutations. Preserve their current request formats if a prototype is connected; do not guess new payloads from a chart mock.

### Existing action payloads

```ts
// POST /api/files/upload -> 201 FileRecord
interface UploadRequest {
  workspaceId: string;
  name: string;
  mimeType: string;
  data: string; // UTF-8 content or base64, selected by dataEncoding
  dataEncoding: 'utf8' | 'base64';
  metadata?: Record<string, unknown>;
}

// POST /api/files/<fileId>/archive|restore?workspaceId=<id> -> 202
interface FileTransitionResponse {
  job: JobRecord;
  created: boolean;
}

// POST /api/keys -> 201; GET /api/keys never returns rawSecret
interface CreateApiKeyRequest {
  name: string;
  workspaceId?: string | null;
  scopes?: string[];
  expiresInDays?: number;
}
interface CreatedApiKeyResponse {
  apiKey: ApiKey;
  rawSecret: string; // reveal once at creation, do not persist/display in lists
}

// POST /api/jobs/<jobId>/retry?workspaceId=<id> -> { success, jobId }
// POST /api/jobs/run?workspaceId=<id> -> { outcomes: [...] }
```

For downloads, `GET /api/files/content?workspaceId=<id>&fileId=<id>` returns file bytes, not a JSON record. Gallery returns signed URLs that may expire; request fresh gallery data when an image URL stops working. Existing routes return route-specific HTTP errors; preserve the error string in the UI and do not assume all endpoints share one envelope.

## TypeScript shapes already in Octo

These are current source types, not a promise that every endpoint is formally versioned. Dyad should reuse them where the generated code can import them; otherwise keep the prototypes’ DTOs structurally identical and isolated behind the adapter.

```ts
export type WorkspaceRole = 'owner' | 'admin' | 'operator' | 'member';

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
  isOwner: boolean; // workspace role, not platform-owner status
  retentionDays?: number | null;
}

export type JobState = 'queued' | 'running' | 'completed' | 'failed' | 'paused';

export interface FileRecord {
  id: string;
  workspaceId: string;
  createdBy: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  provider: string;
  storageKey: string;
  status: 'pending' | 'active' | 'deleted';
  contentHash: string | null;
  archiveState?: 'active_r2' | 'archiving' | 'archived_drive' | 'restoring' | 'reconciliation_required' | string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

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

export interface OperationsActivity {
  id: string;
  eventType: string;
  summary: string;
  createdAt: string;
}

// Actual GET /api/activity row; OperationsPage currently consumes a narrower view DTO.
export interface ActivityRecord extends OperationsActivity {
  jobId: string | null;
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
  kind: 'image' | 'video';
  storageKey: string;
  thumbnailUrl: string;
  fullUrl: string;
  createdAt: string;
}
```

Source definitions: [`src/types/auth.ts`](../../src/types/auth.ts), [`src/storage/file-service.ts`](../../src/storage/file-service.ts), [`src/jobs/job-service.ts`](../../src/jobs/job-service.ts), [`src/media/gallery-service.ts`](../../src/media/gallery-service.ts), [`src/api/keys.ts`](../../src/api/keys.ts), [`src/api/capabilities.ts`](../../src/api/capabilities.ts), and [`src/ui/OperationsPage.tsx`](../../src/ui/OperationsPage.tsx). Routes and actual response construction live in [`src/server/index.ts`](../../src/server/index.ts); current browser integration lives in [`src/main.tsx`](../../src/main.tsx).

## Proposed future metrics contracts (not implemented)

Keep these distinct from the current API table. They are a starting point for a later owner-accepted backend slice, not endpoints Dyad can call today.

```ts
export type MetricAvailability = 'available' | 'not_configured' | 'not_collected';

export interface WorkspaceStorageSnapshot {
  contractVersion: 1;
  workspaceId: string;
  observedAt: string; // ISO-8601 UTC
  catalogStatus: 'available' | 'not_available';
  catalog: {
    usedBytes: number;
    fileCount: number;
    activeR2Bytes: number;
    archivedDriveBytes: number;
    transitioningBytes: number;
  };
  quota: {
    status: 'configured' | 'not_configured';
    limitBytes: number | null;
    remainingBytes: number | null;
  };
}

export interface MetricPoint {
  at: string; // ISO-8601 UTC bucket start
  value: number;
}

export interface MetricSeries {
  contractVersion: 1;
  metric: string;
  unit: 'bytes' | 'count' | 'milliseconds' | 'requests_per_minute' | 'ratio';
  from: string;
  to: string;
  stepSeconds: number;
  points: MetricPoint[];
  availability: MetricAvailability;
}
```

**Required semantics if these contracts are implemented:**

- Quota is scoped to an explicitly identified workspace or principal. The first recommendation is workspace scope; do not infer a principal quota from `createdBy`.
- `catalog.usedBytes` is computed from canonical file metadata and excludes deleted records. Tier buckets are mutually exclusive and sum to `usedBytes`; transitional bytes are not double counted.
- `quota.status === 'not_configured'` means both limit and remaining are `null`. It never means unlimited.
- A platform-owner fleet response would be a separate owner-authorized aggregate endpoint. Tenant clients continue to request one workspace and cannot read other tenants’ totals.
- A series response defines UTC bucket times, units, sampling interval, and source window. Empty points plus `not_collected` is honest; fabricated zeroes are not.
- API request latency, request/error volume, and throughput need server-side measurement and retained samples. Do not estimate them from browser page-load timing.

Possible route names for later discussion: `GET /api/workspaces/<workspaceId>/usage/storage`, a platform-owner-only fleet usage summary, and a workspace-scoped time-series read route. These names are proposals, not existing routes. Numeric quota policy, owner exception, retention window, sampling interval, and any extra metric fields remain undecided.

## Prototype review checklist

- [ ] A normal tenant view cannot reveal another workspace’s name, file count, storage, or job state.
- [ ] The platform owner has a distinct fleet summary and a clear path to a selected workspace.
- [ ] Workspace owner and platform owner are not labeled as if they were the same role.
- [ ] The default visual treatment is dark; all styling maps to replaceable semantic tokens.
- [ ] Current catalog usage, job counts, and activity are visibly tied to a workspace and a current observation.
- [ ] Missing quota and time-series telemetry use honest unavailable states; they are not rendered as zero or unlimited.
- [ ] Any fixture/chart sample data says “Demo data” in the visible UI.
- [ ] Existing file, gallery, operations, and access actions map to current endpoint behavior.
- [ ] Mobile layout preserves the workspace selector, key status cards, and readable tables without horizontal overflow.
- [ ] The generated prototype returns with its API gaps listed separately from its visual work.
