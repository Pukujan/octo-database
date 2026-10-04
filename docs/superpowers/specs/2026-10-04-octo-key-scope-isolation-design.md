# Octo — Key-Scope Isolation Fence (slice design)

Status: **LOCKED** — owner accepted the packet as written on 2026-10-04, and
chose **one-time owner-applied SQL** for reaching the live gravebuster database.
Implementation proceeds against this contract. Packet follows
`docs/productization/SLICE_CONTRACT.md`.

**Amendment (2026-10-04, owner-approved).** The packet specifies a single runtime
role (`octo_app`) with the trusted surface routed through SECURITY DEFINER
functions. When the divergence surfaced during implementation the owner chose the
**two-pool / two-role** variant instead ("go way b"): `octo_app` (RLS-fenced) for
the request path and `octo_service` (BYPASSRLS) for the trusted surface, selected
by which pool object the code holds rather than by per-call SECURITY DEFINER
routing. This is a deliberate, owner-selected change to the SDD below; the PDD
(job, scope, observable success) is unchanged. See **Implementation
reconciliation** at the end.

Related: issue #111 (OIO observational record of the finding), and the boundary
audit comment on it.

---

## Why this slice exists

Octo's promise is "host once, serve many": one keyhole in front of shared
PostgreSQL, many workspaces, isolated by auth. The intended engine-level backstop
is Row-Level Security. The boundary audit (issue #111) confirmed:

- There is **one** live data path: everything goes through `dbPool`
  (`src/server/db.ts:15-26`), which connects as `DATABASE_URL` — the `postgres`
  superuser in production (`deploy/gravebuster/.env.example:11`).
- Superusers bypass RLS unconditionally, and the server never sets
  `request.jwt.claim.sub`, so **the policies never fire**.
- The whole `supabase-js` / `.from(...)` layer is dead code
  (`createOctoClient` is never imported; `src/main.ts` imports the services as
  `import type` only). So there is no second, RLS-enforced path.
- Isolation today rests entirely on hand-written predicates, which the audit
  found complete and consistent on every path read — but that is the only wall.

This slice gives the keyhole an engine-enforced wall.

### The subtlety that shapes the design

RLS as currently written protects **principal ↔ workspace**: the policies ask
"is the current *principal* a member of this row's workspace?". But the scary
case the owner named — *"someone's agent ruins another project's database"* — is
a **workspace-scoped API key escaping to a different workspace its principal
also belongs to**. A principal-scoped RLS policy does **not** stop that, because
the principal genuinely is a member there. The key's *scope* is an application
concept that the engine currently cannot see.

So the fence must be keyed on the **key's workspace scope**, not only the
principal. That is the core design decision below.

---

## PDD — product definition

**User / actor**
The platform owner, and any friend/colleague/agent holding a workspace-scoped
Octo API key.

**Job**
Hand someone a key that is safe to give to an agent: it can reach exactly the
workspaces it is scoped to, and *cannot* reach any other workspace — even if the
application code has a bug — without first being revoked.

**Why**
The owner wants to run long-horizon projects for friends with no local DB
management. Handing out keys is the whole point, and "someone's agent ruins
another project's database" is the stated fear. Today that safety is one missed
`if` away.

**In scope**
- A non-superuser runtime database role (`octo_app`) so RLS actually applies to
  the server's own connection.
- Per-request identity: set the principal claim *and* the key's workspace scope
  as session GUCs on the connection the request runs on.
- A workspace-scope fence in the RLS policies of the **key-reachable tenant data
  tables**, so a scoped key's session can only touch its own workspace's rows.
- Completing the policies/verbs the server actually uses on those tables, so the
  flip does not break working flows.
- Keeping the pre-auth / bootstrap path (login, principal upsert, key verify,
  provisioning) working through SECURITY DEFINER functions.

**Out of scope**
- **A: provisioned database per workspace + per-workspace role.** Deferred by
  owner decision (this slice is "B now, A later"). Do not build provisioning,
  per-workspace credentials, or a control-plane.
- Fencing the server-owned control tables (`jobs`, `activity`) from a *trusted
  server* path. They keep the existing model; see SDD classification.
- New endpoints, SDK, CLI, MCP tools, frontend, or docs changes.
- Formal methods (Lean/Coq/Dafny) — the failure mode is wiring, not algorithm.
- Any hardening beyond the fence itself (rate limits, audit pipeline, rotation
  ceremony, scanners). Not requested, not required for the job to function.

**Reuse**
- Existing RLS policies and the `octo.current_principal_id()` /
  `is_workspace_member()` / `get_workspace_role()` SECURITY DEFINER helpers.
- Existing SECURITY DEFINER functions (`verify_api_key`, `claim_job`,
  `resolve_share`, `match_chunks`).
- Existing `keyWorkspaceMatches` / `effectiveWorkspaceRole` scope logic in
  `src/server/index.ts` (the fence is a backstop for it, not a replacement).
- `auth.uid()` already reads `current_setting('request.jwt.claim.sub', true)` —
  missing-GUC-safe (returns NULL, does not error). No change needed there.

**Observable success**
- The runtime role is a non-superuser, non-owner role; `SELECT rolsuper` is false
  and `pg_class.relowner` is not it.
- Every authenticated request sets both GUCs for its duration and clears them on
  release.
- A workspace-scoped key, with the application's `keyWorkspaceMatches` check
  deliberately disabled in a test build, still cannot read or write another
  workspace's rows — the engine refuses.
- All existing user flows (login, upload/download, archive/restore, jobs,
  gallery, activity, RAG ingest/query, key mint/revoke) still pass end to end.

---

## SDD — system and interface design

**Authority / canonical state**
Unchanged. PostgreSQL remains the canonical metadata store; the fence changes
*who can see which rows*, not where truth lives.

**Capabilities**
No new workspace capability. This changes enforcement on the existing
capabilities (files, jobs, gallery, activity, RAG, keys).

**API contract**
No request/response shape changes. The contract gains an *enforcement
guarantee*: a workspace-scoped key can only affect its own workspace.

**Provider / data flow**
- Roles: the packet specified one role; the owner's amendment chose two (see
  **Implementation reconciliation**). `octo_app` (LOGIN, `NOSUPERUSER`,
  `NOCREATEDB`, `NOCREATEROLE`, no `BYPASSRLS`) serves the request path;
  `octo_service` is the same plus `BYPASSRLS` for the trusted surface. Tables stay
  owned by the migration role; the app role only holds DML grants, so ordinary RLS
  applies to it and `FORCE ROW LEVEL SECURITY` is **not** needed (it would only
  matter if the app role owned the tables).
- Per request, the handler binds a dedicated client:
  1. `SELECT set_config('request.jwt.claim.sub', $authUserId, false)` — principal.
  2. `SELECT set_config('request.workspace_id', $keyWorkspaceId, false)` **only**
     when the request is authenticated by a workspace-scoped key; left unset for
     account-wide keys and human sessions.
  3. run the handler's queries on that client (bound via `AsyncLocalStorage`, so
     the existing `query()` helper routes to it without changing call sites);
  4. `RESET` both GUCs, then release. On error, release with the error so the
     pool discards the connection rather than returning a poisoned one.
- No long transaction is held across the handler — handlers make external HTTP
  calls (R2/Drive/embeddings), and holding a transaction open across them would
  starve the pool. Identity is bound to the *client*, cleared in a `finally`.
- `octo.current_workspace_id()` — new SECURITY DEFINER helper reading
  `current_setting('request.workspace_id', true)` (NULL-safe).

**The fence predicate.** On key-reachable tenant tables, the policy's
`USING`/`WITH CHECK` gains:

```sql
workspace_id = octo.current_workspace_id() OR octo.current_workspace_id() IS NULL
```

AND-ed with the existing membership/role predicate. Semantics:

| Request authenticated by | `request.workspace_id` | Effect |
|---|---|---|
| Workspace-scoped key | that workspace | rows outside it are invisible/refused |
| Account-wide key | unset (NULL) | membership predicate only (today's behavior) |
| Human session | unset (NULL) | membership predicate only (today's behavior) |

**Table classification** (this is the part a naive "flip the role" would get
wrong — the audit found the current policies were written for a *trusted server*
model and are deliberately incomplete):

1. **Key-reachable tenant data — fence + complete verbs.** `files`, `shares`,
   `documents`, `document_versions`, `embedding_configs`, `chunks`, `embeddings`,
   the `epistemic_*` tables, and `api_keys`. Missing verbs must be added or the
   flip breaks working flows:
   - `chunks` / `embeddings`: no DELETE policy, but `dbReplaceChunksAndEmbeddings`
     (`src/server/db.ts:1069`) deletes them on re-ingest.
   - `document_versions`: no UPDATE policy (extraction status).
   - `api_keys`: no UPDATE policy (`last_used_at` via `verify_api_key`, and
     revoke).
   - `principals` / `workspaces` / `workspace_memberships`: the pre-auth inserts
     (login upsert, workspace + membership provisioning) happen before a claim
     exists, so they stay on the SECURITY DEFINER / trusted path, not the fence.
2. **Server-owned control — keep the trusted path.** `jobs` and `activity`
   (`supabase/migrations/20261001030000_slice6_jobs_and_activity.sql:54-65`)
   intentionally have SELECT-only policies because "only the server transitions
   job state". Their writes are already routed through SECURITY DEFINER
   (`claim_job`); the remaining transitions (`complete`/`fail`/`enqueue`/
   `recordActivity`) move behind SECURITY DEFINER functions rather than gaining
   client-facing write policies. A scoped key still cannot *read* another
   workspace's jobs/activity (SELECT policy + fence).
3. **Identity / bootstrap.** Principal resolve, key verify, login upsert,
   workspace provisioning — SECURITY DEFINER functions. These are pre-identity
   by nature and cannot be principal-scoped; they are the audited privileged
   surface, kept small.

**Client surfaces**
None change. MCP/CLI/SDK/frontend all go through the same HTTP API and inherit
the fence.

**Existing code reuse / replacement**
- Reuse: `db.ts` `query()` helper (routed through the bound client), all existing
  `db*` functions, the scope helpers in `index.ts`, the SECURITY DEFINER helpers.
- Change: `db.ts` gains the request-scoped client binding; `index.ts` wraps
  authenticated handler bodies in the binding helper; the auth/bootstrap
  functions in `db.ts` move to SECURITY DEFINER calls.
- Delete: nothing in this slice. (The dead `supabase-js` layer is noted in #111
  but removing it is a separate, non-blocking cleanup.)

**Failure boundary**
- In scope: a scoped key attempting cross-workspace read/write; a handler that
  forgets `keyWorkspaceMatches`; GUC left set on a pooled connection (must not
  happen — `finally` reset + release-on-error).
- Out of scope: Postgres itself being compromised; a leaked *superuser*
  credential; a malicious DB operator; concurrency/scale-out (Issue #14); R2/Drive
  authorization (separate surface).

---

## EVAL / TDD — completion oracle

**Public deterministic**
- Role assertions: the runtime role is non-superuser and not the table owner.
- GUC assertions: a request sets both GUCs; they are absent after release.
- Policy-completion migration tests: every (table, verb) the server uses has a
  satisfying policy (extend `tests/test_slice1_schema.py`-style checks).
- Legit flows under the app role: file upload/download/delete, archive/restore,
  job enqueue/claim/complete, gallery list, activity list, RAG ingest + re-ingest
  + query, key mint/revoke, guest login, Google login — all green.

**End-to-end user flow**
Through the real HTTP API (and one MCP path), as a workspace-scoped key: create a
file and a job in its own workspace; then attempt the same against a second
workspace the principal is *also* a member of, and observe a deny.

**Metamorphic / property**
The invariant this slice exists for:

> For any workspace-scoped key K bound to workspace W, and any workspace X ≠ W,
> no request authenticated by K — with the application's `keyWorkspaceMatches`
> check disabled — can read or write any row of X.

Run as a property test over generated principals/workspaces/keys, plus the
existing "unrelated principal denied" checks. This is the slice's primary claim.

**Hidden holdout**
One small holdout the implementer does not see: a cross-workspace attempt through
a *different* endpoint than the public test uses (e.g. the RAG or gallery path
rather than files), with a scoped key whose principal is a member of both
workspaces. Guards against fencing only the path named in the public test.

**Production smoke**
After deploy: (1) the app role is non-superuser; (2) a real scoped-key request
succeeds in its own workspace; (3) a scoped-key request naming another workspace
is denied. Owner-only; no production data mutated beyond the owner's own test
workspace.

---

## Risks and one owner decision

| Risk | Note |
|---|---|
| **Flip breaks a working production app** | The policies are incomplete for the server's write patterns (SDD classification). Mitigation: complete the policies in the same migration, keep `jobs`/`activity` on the trusted path, run the full e2e suite against the **app role**, not `postgres`. |
| **Pool exhaustion** | A client is held per in-flight request (identity must live on one connection). Mitigation: raise pool `max`; requests are short. |
| **GUC leak across pooled requests** | Mitigation: `finally` reset + release-with-error; asserted by a test. |
| **Platform-owner "see all workspaces"** | Today the owner sees every workspace via an app-level bypass (`db.ts:184-229`). Under RLS that must become an explicit `octo.is_platform_owner()` policy branch, or the owner loses the operator view. Included in scope. |
| **Migrations only run on a fresh volume** | `docs/superpowers/specs/2026-10-01-octo-gravebuster-deployment-design.md` §7 records that live-schema evolution is deferred. The new fence policies therefore **will not apply to the existing production database** on deploy. |

**Owner decision required — live migration.** How should the fence reach the
existing gravebuster database?

- **(a) One-time owner-applied SQL** against the live DB (run the new migration
  by hand / via console), keeping the "migrations run on fresh volume only"
  stance. Smallest change; matches current practice.
- **(b) Add live migration tooling** so migrations apply on boot against an
  existing volume. Bigger; touches the deploy path; arguably its own slice.

Recommendation: **(a)** for this slice — it is the minimum sufficient change to
make production actually fenced, and (b) is a deployment-capability slice that
should not be smuggled in here.

---

## Lock

Owner accepted: 2026-10-04 — packet locked as written.

Owner decisions recorded against this packet:

1. **Live migration mechanism: (a) one-time owner-applied SQL.** Accepted as
   written; the fence reaches the existing gravebuster database by running the
   migration by hand, not by adding boot-time migration tooling.
2. **Runtime roles: two pools (owner "Way B").** The owner accepted the packet's
   single-role design in principle but, on seeing the implemented two-pool variant,
   chose to keep **two roles** — `octo_app` (RLS-fenced request path) and
   `octo_service` (BYPASSRLS trusted surface) — over the packet's
   SECURITY-DEFINER-per-call routing. Recorded in the amendment above and in
   **Implementation reconciliation** below.

Locked at: 2026-10-04.

---

## Implementation reconciliation

Recorded after implementation so a future reader does not have to reconstruct why
the code differs from the SDD prose above. The PDD is unchanged; only the SDD's
"one pool, one role" mechanism was superseded by owner decision.

- **Two roles, two pools.** `src/server/db.ts` exports `dbPool` (→ `octo_app`) and
  `servicePool` (→ `octo_service`). The request path runs on `dbPool` and is
  RLS-fenced; login/bootstrap, the job worker, the archive lifecycle, and the
  server-owned `jobs`/`activity` writes run on `servicePool` and bypass RLS. Which
  pool object the code holds is the reviewable boundary — no per-call SECURITY
  DEFINER routing for the control-table writes the packet's §2 described.
- **Identity binding.** `authenticateRequest` calls `bindRequestIdentity(principalId,
  keyWorkspaceId)`; `query()` binds `octo.principal_id` and `request.workspace_id`
  with `set_config(..., is_local => true)` inside a per-statement transaction, so
  the claims are discarded at COMMIT/ROLLBACK and cannot leak across pooled callers.
  This differs from the packet's `set_config(..., false)` + `finally RESET`; the
  transaction-local form is leak-safe by construction and was preferred for that.
- **Bootstrap identity.** The packet bound `request.jwt.claim.sub`; the
  implementation binds `octo.principal_id` directly (with the `auth_user_id` lookup
  retained as a fallback in `current_principal_id()`), so the first fenced read does
  not need to resolve the principal through `principals`.
- **Fence self-sufficiency.** A policy on a table without RLS enabled is inert. The
  migration enables RLS on every table it fences rather than trusting an earlier
  slice to have done it — a slice8 abort (no `vector` extension) had left
  `documents`/`chunks` un-enabled locally, so the fence policy existed but did
  nothing.
- **Control tables.** `jobs`/`activity` keep SELECT-only policies; their writes go
  through `servicePool`, not client-facing write policies. A scoped key still cannot
  read another workspace's jobs/activity (SELECT policy + fence).
- **Observable success, restated.** The packet's "runtime role is non-superuser,
  non-owner" holds for **both** roles (both are `NOSUPERUSER NOCREATEDB
  NOCREATEROLE`; only `octo_service` adds `BYPASSRLS`). The engine-level invariant
  is proven by `scripts/verify-key-scope-fence.ts` (cross-workspace read/write
  denial + GUC-leak safety) and the flows by the E2E suite run **as `octo_app`**.
- **Background paths.** Any code path that runs with no caller identity (the
  retention sweep, the job worker) must read tenant data through the trusted pool;
  `dbGetFile` is fenced and returns nothing without a bound principal, so the sweep
  reads its archive target via `dbGetArchiveRecord` (service pool).
- **Enqueue contract.** `dbEnqueueFileTransition` runs on the service pool because
  its `jobs` INSERT has no client-side policy and its `FOR UPDATE` file lock is
  load-bearing for delete serialization. That read is unfenced, so the function is
  trusted/internal only: every caller must first perform a fenced, scope-bound read
  of the same file on the app pool (the archive/restore route does this via
  `dbGetFile` immediately before enqueueing). The route's `keyWorkspaceMatches` +
  membership + fenced `dbGetFile` is the fence for that path; the trusted-caller
  contract is stated in the function's own comment.
