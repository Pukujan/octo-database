# Slice 1 — Workspace Capability Discovery (Draft)

**Status: pending independent critique and owner acceptance. Do not implement until the owner locks this packet on issue #77 or its accepted child issue.**

## PDD

**User / actor:** An authenticated user, application, or agent with an existing Octo credential.

**Job:** Select an accessible workspace, discover the operations available to that caller there, and invoke an advertised operation without guessing about permissions, provider setup, or endpoint semantics.

**Why now:** SDK and frontend work need one dependable contract. Current `/api/capabilities` filters primarily by granted scopes and can overstate workspace creation, operator-only actions, or archive actions when Drive is not configured.

**In scope:**

- Stabilize existing HTTP operations described by `src/api/capabilities.ts`.
- Add workspace-specific capability discovery derived from current membership, credential workspace binding, granted scopes, and configured providers.
- Make discovery agree with the existing route checks for the bounded operation inventory below.
- Correct demonstrated gaps where workspace-bound keys can cross their binding, or where route scope checks disagree with capability descriptors.
- Define request, response, and examples for this surface.
- Verify discovery through HTTP alongside the existing prototype screen. Any durable capability-availability UI waits for the selected shell after the frontend bakeoff.
- Preserve current endpoint URLs and provider integrations.

**Out of scope:** Auth-provider migration; new roles or scopes; new database topology; a general policy engine; new business capabilities; SDK, CLI, or MCP implementation; provider administration UI; unrelated hardening.

**Reuse:** Existing credentials, principal/workspace membership, scope names, route handlers, `src/api/capabilities.ts`, `src/server/db.ts`, storage providers, and existing dashboard components.

**Observable success:** A workspace-bound read-only caller discovers and uses its allowed read actions, cannot discover or invoke operations for another workspace, and sees no callable archive action when Drive is absent. Discovery grants no authority beyond route enforcement.

## SDD

**Canonical state:** PostgreSQL owns principals, memberships, API keys, workspace records, file metadata, and jobs. R2 and Drive keep their current file-byte ownership. Capability output is derived and includes no provider credentials. The deployed API uses direct PostgreSQL and application authorization; this packet does not assume Supabase Auth or RLS runtime enforcement.

**Capabilities:** Existing account and workspace operations, filtered by the caller's live identity, membership, credential binding, granted scopes, and configured provider availability.

**API contract:** Extend discovery with a selected-workspace form:

```http
GET /api/capabilities?workspaceId=<uuid>
Authorization: Bearer <existing credential>
```

For workspace mode, return the existing fields plus the following fields and preserve existing descriptor fields. Keep the no-query response shape compatible.

```ts
type CapabilityResponse = {
  contractVersion: 1;
  discoveryMode: 'workspace' | 'unbound';
  workspace: { id: string; role: WorkspaceRole } | null;
  principal: { id: string; isGuest: boolean };
  token:
    | { type: 'session' }
    | { prefix: string; workspaceId: string | null; isAccountWide: boolean; scopes: OctoScope[] };
  auth: typeof AUTH_GUIDANCE;
  capabilities: CapabilityDescriptor[];
  unavailable: Array<{ action: string; reason: 'PROVIDER_UNAVAILABLE' }>;
};
```

`capabilities` means authorized and configured, not guaranteed success for every resource state. `unavailable` contains only otherwise-authorized actions missing provider configuration; it does not enumerate actions the caller lacks permission to use. Add no schema compiler or generated policy framework.

Example success response for a member with a workspace-bound read key:

```json
{
  "contractVersion": 1,
  "discoveryMode": "workspace",
  "workspace": {"id": "11111111-1111-4111-8111-111111111111", "role": "member"},
  "principal": {"id": "22222222-2222-4222-8222-222222222222", "isGuest": false},
  "token": {"prefix": "octo_live_ws", "workspaceId": "11111111-1111-4111-8111-111111111111", "isAccountWide": false, "scopes": ["files"]},
  "auth": {"scheme": "Bearer", "header": "Authorization: Bearer <octo_live_...>", "note": "Use the existing AUTH_GUIDANCE note."},
  "capabilities": [
    {"action": "files.list", "method": "GET", "path": "/api/files?workspaceId=<id>", "requiredScope": "files", "description": "List files in an authorized workspace."},
    {"action": "files.download", "method": "GET", "path": "/api/files/download?workspaceId=<id>&fileId=<id>", "requiredScope": "files", "description": "Get a download URL for one file."},
    {"action": "gallery.list", "method": "GET", "path": "/api/gallery?workspaceId=<id>", "requiredScope": "files", "description": "List gallery media in an authorized workspace."}
  ],
  "unavailable": []
}
```

Return the existing `AUTH_GUIDANCE` constant verbatim; the shortened note above is illustrative only. Endpoint errors keep the existing top-level `error` string and add these stable fields for this endpoint only:

```ts
type DiscoveryError = {
  error: string;
  code:
    | 'UNAUTHENTICATED'
    | 'INVALID_WORKSPACE_ID'
    | 'WORKSPACE_ACCESS_DENIED'
    | 'CAPABILITY_LOOKUP_FAILED';
  message: string;
};
```

| HTTP | Code | Example |
|---|---|---|
| 401 | `UNAUTHENTICATED` | `{"error":"UNAUTHENTICATED","code":"UNAUTHENTICATED","message":"A valid Octo credential is required."}` |
| 400 | `INVALID_WORKSPACE_ID` | `{"error":"INVALID_WORKSPACE_ID","code":"INVALID_WORKSPACE_ID","message":"workspaceId must be a UUID."}` |
| 403 | `WORKSPACE_ACCESS_DENIED` | `{"error":"WORKSPACE_ACCESS_DENIED","code":"WORKSPACE_ACCESS_DENIED","message":"This credential cannot access the requested workspace."}` |
| 500 | `CAPABILITY_LOOKUP_FAILED` | `{"error":"CAPABILITY_LOOKUP_FAILED","code":"CAPABILITY_LOOKUP_FAILED","message":"Workspace capabilities could not be loaded."}` |

- Missing authentication: `401`.
- Malformed workspace ID: `400` with code `INVALID_WORKSPACE_ID`.
- Caller cannot access the workspace or a key is bound elsewhere: `403` with code `WORKSPACE_ACCESS_DENIED`.
- Valid workspace: `200`, with an empty eligible set allowed where appropriate.
- Preserve the existing string `error` field; add stable `code` and readable `message` for this endpoint only. Missing auth is `401/UNAUTHENTICATED`; a database lookup failure is `500/CAPABILITY_LOOKUP_FAILED` and must not be returned as an empty success.
- Without `workspaceId`, return `discoveryMode: 'unbound'`, `workspace: null`, and `unavailable: []`, preserving current principal/token/auth/capability fields. A workspace-bound credential must not be told it can create an account-level workspace.
- Do not list denied operations for another workspace.

**Bounded operation inventory:**

- Account: workspace list/create and revocation of the caller's own API keys.
- Workspace: file list/upload/download/delete/archive/restore; gallery list; jobs list/enqueue/run; activity list.
- Existing `workspaces.delete.any` retains its current human/confirmation rules and is not newly advertised as an ordinary agent action.

Use these existing route thresholds: file/gallery reads and workspace jobs/activity reads require membership plus their existing scope; upload, archive, restore, job enqueue, and job run require operator or higher plus their existing scope; file deletion requires admin or owner plus `delete`; key revocation remains limited to the caller's own key. Workspace creation is unavailable to workspace-bound keys. Keep a workspace-bound credential within its bound workspace and intersect its documented role cap with live membership. All advertised file reads, including presigned URL issuance, gallery listing, and bearer-authenticated content/thumbnail routes, require the `files` scope and must respect a workspace-key binding. Provider availability changes storage/archive actions only; temporary provider outages remain normal operation failures.

**Provider/data flow:** Capability availability derives from configuration. PostgreSQL remains the source for principal, membership, file metadata, and job state; R2/Drive continue to own bytes. No client receives provider credentials.

**Client surfaces:** Existing HTTP API and current prototype-screen verification only. SDK, CLI, MCP, and any durable capability dashboard view are later slices.

**Existing code:** Reuse `src/api/capabilities.ts`, the relevant routes in `src/server/index.ts`, membership/key lookup in `src/server/db.ts`, and existing UI components. Keep resource validation in its current route; do not create a parallel authorization framework.

**Failure boundary:** Missing or revoked credential, lost membership, workspace mismatch, absent provider configuration, and ordinary operation failure. Correct demonstrated discrepancies within this inventory; do not add an exhaustive auth/storage failure matrix.

## EVAL / TDD

**Public deterministic evals:**

- A workspace-bound `files` key lists/downloads a fixture but does not advertise account workspace creation or file upload. Its `files.download` call must require `files`, matching the descriptor.
- The same principal owns workspaces A and B; an A-bound key receives `403` for B discovery, file list, download, gallery, bearer-authenticated content, and thumbnail requests. These routes must enforce the same workspace binding; membership alone is insufficient for a workspace-bound key.
- A `member` with `write` scope is not advertised operator-only upload or job-run actions, and the existing route refuses them.
- If the otherwise-authorized caller has no configured Drive, archive/restore appear in `unavailable`, not `capabilities`; a temporary provider outage remains an operation failure.
- Every returned descriptor names an implemented method/path; refusal behavior is compared for the named operations only.
- Existing no-workspace response remains compatible.

**End-to-end user eval:**

1. Create/select a test workspace using the current UI.
2. Upload a small fixture through the existing file flow.
3. Create a workspace-bound read-only key.
4. Discover that workspace's capabilities using the key.
5. List and retrieve the fixture through advertised operations; compare bytes.
6. Confirm a write is refused.
7. Revoke the key and confirm a subsequent request is refused.
8. Verify the existing prototype can reach the described flow. A new capability panel belongs to the selected post-bakeoff shell, not this slice.

Use two workspaces owned by the same principal for the workspace-bound case; different principals alone would not expose the binding defect. Include direct byte/content routes in that case, not just advertised list operations.

**Targeted properties:** Removing a scope cannot add eligible actions; changing the requested workspace cannot widen a bound key; removing membership cannot leave discovery permissions cached; discovery contains no provider credentials.

**Hidden holdout:** None. The named workspace and credential variants cover the likely false-completion cases.

**Production/test smoke:** Run discovery, read, and download against the deployed candidate using a designated test workspace/credential. Main delivery requires green `gates`. A production promotion is a pull request into `production` with auto-merge armed.

**Done:** Owner accepts/corrects this packet; all named evals pass; the end-to-end job and deployed smoke work; `gates` is green on the exact candidate. Compilation alone is insufficient.

## Lock

- Owner accepted/corrected: **pending**
- Locked at: **not locked**

## Decisions for owner review

1. Accept or correct capability discovery as the first product slice, ahead of fresh-machine recovery.
2. Confirm the bounded workspace operation inventory and response/error fields.
3. Confirm that configured-provider availability controls whether archive/restore is advertised, while transient outages remain operation failures.
