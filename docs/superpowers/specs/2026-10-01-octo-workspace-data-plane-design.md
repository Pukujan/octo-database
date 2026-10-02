# Octo workspace data plane — design

**Date:** 2026-10-01
**Status:** Approved (owner), pending spec review
**Issue:** #61 (research + plan), #62 (padding/server defects)
**Contract:** issue #1 program authority; `AGENTS.md` anti-overengineering rules apply.

## Problem

The owner asked how Octo actually behaves for an application that needs a
workspace and a key. Research (issue #61) found the product surface is
incomplete and, in places, only half-wired:

- No `POST`/`DELETE` for workspaces — a workspace can only be auto-provisioned
  by login. `createWorkspace()` is dead code.
- No "database" concept: a workspace is the only boundary.
- API keys exist and are creatable, but there is no revoke/expiry/scope UI, the
  `admin` scope is never enforced, and several routes skip scope checks.
- `src/api/gateway.ts` — the module meant to route agent calls — is dead code.
- Archive is manual only; there is no retention, tiering, or scheduler.
- No protection on destructive commands.

## Owner decisions

1. **Workspace = database.** One workspace per logical database. No new
   `databases` sub-entity.
2. **Destructive commands need a human confirmation** beyond role/scope.
3. **Archive gets automatic retention/tiering** plus a scheduler.
4. **Agent API is wired and documented properly.**
5. **One account-wide key total**, plus **one workspace key per workspace**,
   auto-provisioned at workspace creation (secret shown once).
6. **Agent permissions** use named presets plus a custom scope picker.

## Design

### 1. Data model

The workspace remains the single tenancy boundary. No new entity. A "database"
for an app is a workspace; its files and keys hang off it exactly as today.

### 2. Workspace create / delete

**`POST /api/workspaces`** — human session or account-wide key.

- Body: `{ name, slug?, description?, retentionDays? }`.
- `slug` defaults to a slugified `name`; uniqueness is enforced by the existing
  `workspaces.slug` UNIQUE constraint. A collision returns `409 SLUG_TAKEN`.
- The create runs as **one transaction** over three writes: the `workspaces`
  row, the creator's `owner` membership, and the auto-provisioned workspace key
  (see §4). Partial failure rolls back — no workspace without a key.
- Requires the `write` scope for key callers. Role is implicit: the creator
  becomes owner.

**`DELETE /api/workspaces/:id`** — owner (or platform owner) only.

- Requires the confirmation gate (§3) and the typed slug.
- **Refuses while any file in the workspace is in a transient archive state**
  (`archiving` or `restoring`), returning `409 WORKSPACE_BUSY`. Deleting during
  a copy would orphan R2/Drive bytes.
- Deletes the workspace row; `ON DELETE CASCADE` removes files, keys, shares,
  memberships, and jobs. Object bytes in R2/Drive are **not** reclaimed by the
  cascade; the response reports `orphanedObjects` so the operator sees the
  consequence rather than a silent leak. (Byte reclamation is out of scope — see
  §10.)

UI: a "New Workspace" control and a "Delete Workspace" action wired to the
existing (currently inert) capability chips.

### 3. Destructive-command protection

There is no password system; auth is OAuth/guest and the session token is the
principal's UUID. The gate is therefore a per-account **confirmation secret**:

- New column `principals.confirm_secret_hash TEXT`. Set/rotate via
  `POST /api/me/confirm-secret` (human session only). Hashed with the existing
  `hashApiKeySecret` — no new crypto.
- **Fail-closed:** if unset, destructive routes refuse with
  `412 CONFIRM_SECRET_NOT_SET`.
- A destructive route accepts the gate only when **both** hold:
  1. the caller is a **human session** — `auth.apiKey` is undefined. An API-key
     caller can never satisfy the gate, whatever its scopes; and
  2. `body.confirmSecret` hashes to the stored value.
- Applies to workspace delete, and is the reusable gate for later destructive
  commands (drop/purge). Workspace delete additionally requires
  `body.confirmSlug === workspace.slug`.

This structurally answers "will a blind agent be able to delete a workspace":
no — the key path cannot satisfy the human-session requirement.

### 4. API keys

- **Account-wide:** at most one per principal. It is **not** created by the
  workspace-create transaction; it is minted on explicit request, prefix
  `octo_live_acc_`, `role NULL`. `POST /api/keys` with `workspaceId` null when
  an account-wide key already exists returns `409 ACCOUNT_KEY_EXISTS` with
  guidance to revoke it first — no duplicate account-wide keys.
- **Workspace key:** exactly one per workspace, auto-created in the workspace
  create transaction, prefix `octo_live_ws_`, `role` = creator's role. Its
  secret is returned once in the create response.
- **Presets:** `Read-only` → `[read, files]`; `Read-write` →
  `[read, write, files]`; `Ingest` → `[write, files]`; `Full` →
  `[read, write, files, delete]`. Plus `custom` with an explicit scope list.
  `admin` is reserved for platform-owner keys and is enforced (§6).
- UI: keys table gains **Revoke**, **expiry**, and the preset/custom picker.

### 5. Storage routing and archive lifecycle

- **No automatic hot/cold routing.** R2 is the only active tier; Drive is cold.
  Uploads always land in R2. This is stated plainly in the UI so the contract is
  unambiguous.
- **Policy = one column.** `workspaces.retention_days INTEGER` (NULL = never
  auto-archive). That is the entire retention model — no rule engine.
- **Scheduler:** an hourly `setInterval` in the server process (single
  container; no cron, no distributed lock) scans each workspace with a non-null
  `retention_days` for `active_r2` files older than the window, enqueues
  `archive_file` jobs, then calls the existing `drainQueueOnce()`.
- **On-demand recall is unchanged and already works:** `ensureActiveBytes`
  restores Drive→R2 transparently on read.
- Agents may archive/restore only with the appropriate scope (§6).

### 6. Agent API formalization

- Enforce scopes on every route. Add the missing checks to `/api/activity`,
  `/api/jobs/run`, `/api/jobs/:id/retry`, archive/restore, and key revoke;
  define and enforce `admin` (platform-owner-only actions).
- `GET /api/me` stays unscoped (identity), but is documented as such.
- **Delete `src/api/gateway.ts`** (dead code) and keep `capabilities.ts` as the
  single source of advertised actions, reconciled with actual enforcement.
- **Usage docs in the dashboard:** a short "Using your key" panel with the
  endpoint list and a `curl -H "Authorization: Bearer octo_live_..."` example,
  so a CRUD app or agent has a defined contract.

## Schema changes

New migration, idempotent like the rest:

- `ALTER TABLE octo.principals ADD COLUMN IF NOT EXISTS confirm_secret_hash TEXT;`
- `ALTER TABLE octo.workspaces ADD COLUMN IF NOT EXISTS retention_days INTEGER;`
- A partial unique index enforcing one account-wide key per principal:
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_api_keys_account_wide ON octo.api_keys (principal_id) WHERE workspace_id IS NULL;`

## Error handling

- `409 SLUG_TAKEN`, `409 WORKSPACE_BUSY`, `409 ACCOUNT_KEY_EXISTS`,
  `412 CONFIRM_SECRET_NOT_SET`, `403 FORBIDDEN` (role/scope),
  `403 CONFIRM_SECRET_INVALID`.
- All destructive paths fail closed: a missing secret, a key caller, or a
  transient archive state refuses rather than partially applying.

## Testing and verification

### Metamorphic relations

Beyond example tests, the following relations must hold for **any** input, and
are asserted as metamorphic tests:

1. **Idempotent create.** Two identical `POST /api/workspaces` produce exactly
   one workspace and one workspace key.
2. **Key scope containment.** A key's effective reach is a subset of its
   creator's reach at call time: revoking a membership can only shrink what an
   account-wide key can touch, never grow it.
3. **Workspace pinning.** For any `workspaceId` ≠ a workspace-scoped key's own
   workspace, every route returns 403.
4. **Scope monotonicity.** Removing a scope from a key can only remove
   capabilities, never add them.
5. **Archive round-trip fidelity.** `restore(archive(f))` yields bytes whose
   hash equals `f`'s original content hash — for any file.
6. **Archive state is single-valued.** After any sequence of archive/restore
   operations, `archive_state` is exactly one of the five defined values, and
   the bytes exist in at least one tier.
7. **Confirmation gate.** For any request carrying an API key, every destructive
   route refuses, regardless of scopes or body.
8. **Deletion cascade completeness.** After a workspace delete, no row in any
   `octo.*` table references the deleted workspace id.
9. **Cross-workspace isolation.** A member of workspace A can never read or
   mutate a resource in workspace B via any route (the negative invariant from
   issue #1).

### Example tests

- Unit/route: create is atomic (a forced key-insert failure leaves no
  workspace); slug collision; delete refuses on transient archive state; delete
  refuses for a key caller and for a wrong secret; account-wide uniqueness.
- Scope: each previously-unscoped route now denies a key missing the scope.
- Retention: a workspace with `retention_days` set enqueues and drains an
  archive job for an aged file.
- **End-to-end + Playwright + vision:** create workspace → auto key shown →
  upload → archive → restore → delete, with a vision audit of the new UI, run in
  CI where the InferHub credential exists.

## Known defects to fix as part of this work

These were found while writing this spec and are verified against the current
tree:

1. **Re-archive is permanently blocked (verified).** `octo.jobs` has
   `UNIQUE (workspace_id, job_type, idempotency_key)` with no state column, and
   the archive route uses a stable key `archive:<fileId>`. After the first
   archive job exists, a later archive of the same file hits
   `ON CONFLICT DO NOTHING`, returns the old (completed) job, and enqueues
   nothing. So `archive → restore → archive` silently fails the second time.
   Fix: scope the idempotency key to the transition, not the file (for example
   include the current `archive_state` or a monotonic attempt counter), so a
   repeat transition of a *new* cycle is distinct from an in-flight duplicate.
2. **No transaction helper.** `src/server/db.ts` exposes only a
   single-statement `query()` over a pool with no checkout/`BEGIN`/`COMMIT`. The
   atomic workspace-create in §2 requires adding a `withTransaction(fn)` helper
   that holds one client for the duration.

## Additional protections to fold into §3

- **Confirmation-secret rotation.** Changing the confirmation secret is itself a
  destructive action: require the *current* secret (or an email round-trip
  verification) so a stolen live session cannot silently re-key the gate.
- **Race guard on delete.** Delete must take a workspace lock (or re-check
  `archive_state` inside the delete transaction) so a concurrent archive/restore
  cannot slip a transient state in after the pre-check.

## Out of scope

- Byte reclamation for orphaned R2/Drive objects on workspace delete.
- A Postgres/memory hot tier (R2 remains the only active tier).
- Per-database sub-entities, member-management UI, and any retention rule beyond
  a single age threshold.

## Risks

- The confirmation secret is a new credential; it is fail-closed and
  human-session-only, which is the intended behavior, but it means an account
  that never sets it cannot delete a workspace.
- The hourly sweep is in-process; if the server is down, archiving pauses. This
  is acceptable for a single-container deployment and matches the existing
  manual drain.
