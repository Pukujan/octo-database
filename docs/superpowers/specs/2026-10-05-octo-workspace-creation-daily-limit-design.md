# Octo — Workspace-creation daily limit (slice design)

Status: **LOCKED** — owner-accepted decisions recorded on issue #122
(2026-10-05) and the slice's own acceptance criteria on issue #124. Packet
follows `docs/productization/SLICE_CONTRACT.md`.

Related: issue #124 (owning slice), #122 (roadmap + accepted decisions), #52
(future Admin Console home for a human-removable limit).

---

## Why this slice exists

Slice 15 routed `POST /api/workspaces` through the human confirmation gate, so an
API-key caller (an agent) can no longer create workspaces at all. But a **human
browser session** that holds the confirmation secret can still create unlimited
workspaces in a loop — a compromised session, or a stuck client, could fill the
tenant table. This slice adds a second, independent guard that bounds that blast
radius without introducing a policy engine.

The owner's accepted decision (#122, decision 3): **workspace creation only,
1/day per principal, platform owner exempt.** Key minting is *not* rate-limited —
it is already stamped by Slice 15.

---

## PDD — product definition

**User / actor**
Any signed-in principal (guest or member) who creates a project workspace, and
the platform owner who must never be locked out of doing so.

**Job**
Create the workspace they actually need, while being structurally unable to
create a flood of them in a day.

**Why**
Creation is the tenancy-boundary mint. Unbounded creation from a single session
is the remaining spam path after Slice 15. A rolling daily cap closes it with one
derived count and no new state.

**In scope**
- A rolling 24-hour limit of **one** workspace per principal on
  `POST /api/workspaces`.
- Platform owner is **exempt** (no count).
- The **auto-provisioned personal sandbox** a principal receives at sign-in does
  **not** consume the quota (otherwise a brand-new account could not create its
  first project workspace — it already owns the sandbox).
- A clean `429` with the stable code `WORKSPACE_DAILY_LIMIT`, surfaced in the
  create modal.
- The same principal may create again once the window passes.

**Out of scope**
- Rate-limiting key minting, uploads, or any other write (owner chose
  workspace-creation only).
- A generalized rate-limit middleware, policy engine, or counter table.
- An admin console to raise/remove the limit (#52). Until it exists, the
  owner-exempt rule *is* the human override.
- MFA step-up on creation/minting (slices 17–18).
- Concurrency hardening for simultaneous creates (see Failure boundary).

**Reuse**
- Existing `octo.workspaces` rows (`created_by`, `created_at`) — the count is
  **derived**; no new counter table (#124 observed facts).
- Existing `confirmGate` (Slice 15) — the limit is an *additional* condition
  checked after it, never a replacement.
- Existing `principal.isPlatformOwner` flag.
- Existing create modal in `src/main.ts` (which already renders route errors).

**Observable success**
- A non-owner's second create within 24h → `429 WORKSPACE_DAILY_LIMIT`.
- The same principal → `201` after the window passes.
- A platform owner → `201` twice in the same window.
- A brand-new principal with its fresh sandbox → the first create still `201`.
- The create modal shows the refusal text.

---

## SDD — system and interface design

**Authority / canonical state**
Unchanged: `octo.workspaces` is canonical. The quota is *derived* from its rows
(`created_by`, `created_at`), so there is no second source of truth to reconcile.

**Capabilities**
None new. This adds a refusal to an existing capability.

**API contract**
`POST /api/workspaces` gains one failure mode, checked **after** `confirmGate`
and **before** provisioning:

```
429 { "error": "WORKSPACE_DAILY_LIMIT: You can create one workspace per day. Try again after 24 hours." }
```

Success (`201`) and slug-collision (`409`) responses are unchanged.

**Provider / data flow**
- Migration `20261001090000_slice16_workspace_creation_limit.sql` adds
  `octo.workspaces.auto_provisioned BOOLEAN NOT NULL DEFAULT false`.
- The sign-in sandbox insert (`dbInsertWorkspace`) sets `auto_provisioned = true`;
  every API-created workspace defaults to `false` and therefore counts.
- `dbCountCreatedWorkspacesSince(principalId, since)` counts
  `created_by = $1 AND auto_provisioned = false AND created_at >= $2` on the
  **service pool** (trusted count, not RLS-fenced — the count spans the caller's
  own rows only and is not tenant data exposed to the client).
- The route computes `since = now - 24h` and refuses at `>= 1` for non-owners.

**Client surfaces**
Frontend only: the create modal already renders `error` from a failed route, so
the refusal appears with no new UI machinery.

**Existing code reuse / replacement**
- Reuse: `confirmGate`, `dbCreateWorkspaceAtomic`, the create route, the modal.
- Change: `dbInsertWorkspace` marks sandboxes; the create route adds the limit
  branch; `db.ts` adds one count function.
- Delete: nothing.

**Failure boundary**
- In scope: non-owner exceeding the limit; a sandbox wrongly counting; the
  rolling-window boundary.
- Out of scope: two simultaneous creates from one principal could both pass the
  count before either commits (a TOCTOU window). This is not hardened — the limit
  bounds *deliberate* spam from a session, not a race between two in-flight
  requests, and the owner asked for a minimum sufficient guard. Recorded here so
  it is a known limitation, not an oversight.
- Out of scope: clock skew between the app and the database (both use the DB's
  `now()` for `created_at`; the route passes an app-computed `since`, which is
  sufficient at day granularity).

---

## EVAL / TDD — completion oracle

**Public deterministic**
- `tests/e2e/workspace-creation-limit.spec.ts`: first create `201`; second within
  the window `429 WORKSPACE_DAILY_LIMIT`; backdating the first create past 24h
  lets the same principal create again (`201`). This covers the accepted job and
  the rolling window.

**End-to-end user flow**
- The create-modal test drives the real browser: first creation succeeds through
  the UI; the second is refused and the modal renders the
  `WORKSPACE_DAILY_LIMIT` refusal in its alert region.

**Metamorphic / property**
- **Change the acting principal** (per-principal invariant): one principal
  creating does not consume another's quota — two fresh principals each get `201`.
- **Change the owner flag** (exemption invariant): the same principal with
  `is_platform_owner = true` creates twice in the window, both `201`.

**Hidden holdout**
- `tests/e2e/workspace-creation-limit-holdout.spec.ts`: a principal arrives with
  **pre-existing API-created workspaces older than the window** plus a fresh
  sandbox. A naive implementation that counts every owned row would refuse the
  first fresh create; the correct implementation counts only API-created
  workspaces inside the rolling day, so the first fresh create is `201` and the
  second is `429`. Changes meaningful scenario details (unseen history and age)
  while preserving the same claim.

**Production smoke**
- Owner-only: a fresh non-owner guest's second create returns `429`; the owner's
  creates are unlimited. No production data mutated beyond the owner's own test
  principals.

---

## Lock

Owner accepted: 2026-10-05 — decisions recorded on issue #122; acceptance
criteria on issue #124. Locked at: 2026-10-05.

---

## Implementation reconciliation

- **Sandbox exclusion is a column, not a name heuristic.** The packet excludes the
  auto-provisioned sandbox; the implementation records that with an explicit
  `auto_provisioned` boolean rather than inferring it from the slug, so the
  exclusion is durable and reviewable.
- **Service pool for the count.** The count reads through the trusted pool
  (`queryService`) because it is a server-side guard over the caller's own rows,
  not a client-facing tenant read.
- **E2E fixtures that legitimately create two workspaces** (key pinning,
  idempotent create) mark their principal a platform owner via the shared
  `tests/e2e/workspace-quota.ts` helper, so the new limit does not perturb tests
  that exercise a different behavior.
