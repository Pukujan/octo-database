# Slice 7 — Historical Analytics (TDD / Completion Oracle)

**Status: pending independent critique and owner acceptance. Do not implement until the owner locks this packet.**

**This file is subordinate to the authoritative locked-format packet `docs/productization/slices/07-historical-analytics.md`. Where this appendix and the packet differ, the packet governs. This appendix adds eval mechanics and implementation detail only; it redefines no product decision, name, or scope boundary.**

Owning issue: #13 (OCTO-1100, "DuckDB and Parquet analytical workspace over R2 datasets"), aligned to Slice 7 of `SLICE_MAP.md`. Robustness target: **Level 2** (durable dataset and result metadata, real provider integration, deployed smoke).

Tests exist to prove the accepted claim, not to maximize test count. Add no failure matrix beyond the boundaries named here.

## EVAL / TDD

### Public deterministic evals

**Catalog — `tests/unit/analytics-catalog.test.ts`**

- Registering a dataset version writes one catalog row carrying: workspace id, logical dataset id, version number, `format='parquet'`, schema (column names + types), provenance, watermark, row count, and the ordered list of object keys. The row is immutable once written.
- Registering the same logical dataset again produces version 2 with its own object list; version 1's row and object keys are unchanged. Version numbers are **server-assigned**; a concurrent registration of the same slug fails closed (`409`).
- A request body cannot supply an object key outside the version's own derived prefix. Every key is derived from the catalog row's identifiers, never accepted from the caller.
- A dataset version whose recorded schema does not match the Parquet footer, or is missing the accepted spec's required input columns (`job_type`, `state`, `created_at` with compatible types), is rejected at registration with `SCHEMA_MISMATCH`, not accepted and failed later.

**Parquet path conventions — `tests/unit/analytics-paths.test.ts`**

- A dataset version's keys are exactly
  `workspaces/<workspaceId>/lake/<datasetSlug>/v<versionNumber>/dt=<YYYY-MM-DD>/part-<uuid>.parquet`.
  The `<workspaceId>` segment is the authenticated workspace id; it is never taken from a request value.
- Result artifacts are `workspaces/<workspaceId>/lake/_results/<resultId>.parquet`.
- Every derived key is asserted to start with `workspaces/<authenticated workspace id>/`. (The `UNSAFE_OBJECT_KEY` traversal guard lives only in `LocalObjectStore.resolve()`; `R2ObjectStore` has no key guard, so the R2 path relies on derivation plus this prefix assertion, not on that guard.)
- The path layout is an optimization, not the authorization mechanism: authorization is enforced on the catalog row, independent of the path.

**Query submission — `tests/unit/analytics-query.test.ts`**

- The accepted query spec `job-failures-by-type-month@1` compiles server-side to a deterministic SQL string over `read_parquet([...])`. The caller cannot supply SQL; an unrecognized spec id is `400`.
- An unknown `datasetVersionId` is `404`. A `datasetVersionId` owned by another workspace resolves to `404` (no existence leak) before any engine work.
- The enqueued job payload carries only ids (workspace, dataset version, query spec, result id). It contains no R2 credential.
- `rowLimit`/timeout defaults mirror the SQL surface (`src/server/query.ts`) and are clamped server-side.

**Result registration — `tests/unit/analytics-result.test.ts`**

- A completed job registers exactly one result row: object key, row count, `contentHash` (sha256 hex of the result bytes), query spec, dataset version, job id, and `engineVersion`.
- A retry under the same idempotency key resolves to the same job and creates no second result row. Dedupe is anchored on `job_id` via the existing `jobs_idempotency_unique` constraint `(workspace_id, job_type, idempotency_key)`; a *new* idempotency key is a new job and legitimately a new result.

**Authorization — `tests/e2e/analytics.spec.ts`**

- Unauthenticated request is `401`.
- Submitting the accepted query requires `read`; registering a dataset requires `write`. A read-only key is refused at registration.
- The same principal owns workspaces A and B; an A-bound key is refused (`403`) for a B workspace on both the register and query paths, and a B-owned `datasetVersionId` resolves to `404`. Membership alone is insufficient for a workspace-bound key.
- No new scope is introduced; the analytics descriptors reuse the existing `read`/`write` scopes, and the workspace fence is checked **before** the engine is probed, so an unauthorized caller learns nothing about whether analytics is configured (the `tests/e2e/graph-read.spec.ts` shape).
- The capabilities surface advertises the four analytics descriptors with their real required scopes, and discovery grants no authority beyond route enforcement.

**Migration schema — `tests/test_analytics_catalog_schema.py`**

- The migration creates the dataset/version/result tables, enables RLS, adds the Slice 14 RESTRICTIVE tenant fence, grants DML to `octo_service` only, is idempotent (`IF NOT EXISTS`), and has no top-level transaction control. Same checks as `tests/test_slice21_schema.py`.

**Live engine — `scripts/verify-analytics.ts`** (wired into the `gates` job beside `scripts/verify-workspace-query.ts`)

- DuckDB reads **multiple** Parquet files in one query and returns the known aggregate.
- The same logical rows written as one file, as day partitions, or as month partitions (all keys under `dt=YYYY-MM-DD`) return identical logical results. Repartition invariance is the claim; there is no partition-pruning or performance guarantee.
- A corrupt/truncated Parquet object yields a deterministic job failure with a stable error code, never a hang or a silent empty result.
- A schema-mismatched file yields a stable failure code.
- A runaway query is bounded by a clamped timeout; cancellation is deterministic.
- The result Parquet is written to the object store and registered; a retry does not duplicate catalog output.
- The DuckDB dependency is added to `package.json` and pinned to an explicit version (the Node client is alpha upstream, so an unpinned range is not acceptable), and the script's `gates` step installs it so the check actually runs.
- CI has no R2, so this eval uses the explicit local object-store backend (`OCTO_STORAGE_BACKEND=local`) plus the Postgres service, matching the existing Playwright/e2e gates step; the production smoke exercises real R2.

### End-to-end user eval

The real job: **an agent registers a multi-file Parquet dataset and gets a correct answer to the agreed historical question — job failures by type and month — through the HTTP product surface.**

1. The agent (the caller) materializes the multi-file Parquet dataset client-side — no Octo product surface exports it — and registers the version: `POST /api/workspaces/:id/datasets` with the logical slug, `format`, the declared schema, provenance, watermark, and `parts` (base64 bytes + `YYYY-MM-DD` partition). The agent supplies **no path and no object key**; the server derives every key and assigns the version number.
2. The agent submits the agreed query: `POST /api/workspaces/:id/analytics/queries` with `datasetVersionId` and `querySpec: 'job-failures-by-type-month@1'` → job id.
3. The job is drained (`POST /api/jobs/run?workspaceId=` or the worker tick) and polled to a terminal state.
4. The agent fetches the result: `GET /api/workspaces/:id/analytics/results/:resultId` → row count plus a short-lived download URL; the result Parquet bytes are retrieved.

**Observable output.** A result Parquet artifact in R2 with columns `(job_type, month, failure_count)` whose rows equal the expected aggregate computed independently from the same registered source rows. A result row is registered in the catalog. Operational Postgres holds metadata only — the eval asserts the analytical rows were not duplicated into `octo.*` (issue #13's row-count/design evidence).

**Fixtures (deterministic).**

- **Fixture A — synthetic multi-file Parquet.** A known row set written as several Parquet files (one file; N day-partitioned files; month-partitioned files, normalized to `dt=YYYY-MM-DD` keys). The expected answer is computed by plain aggregation in the test, never by re-running DuckDB, so the oracle is not circular.
- **Fixture B — seeded source history.** `octo.jobs` seeded with a known distribution of `state='failed'` rows across several job types and months (including two job types failing in the same month and a month with zero failures for one type). A **fixture producer** (`scripts/analytics-fixture.ts`, test scaffolding only — not a product exporter) materializes those seeded rows into Parquet. The oracle is a Postgres `GROUP BY` over `octo.jobs WHERE state='failed'`, aggregated to month, run on a **test-only direct control-plane connection** — not a Slice 21 route call, because the workspace's own provisioned database holds no `octo` schema. The oracle source is pinned to `octo.jobs.state='failed'` (one row per failed job); `octo.ops_events` is **not** used as the oracle because it is per-event and error-code keyed.

### Metamorphic / property evals

Targeted only. File: `tests/unit/analytics-metamorphic.test.ts`.

- **MR-A Repartition invariance.** The same logical rows written as one file, as N day-partitioned files, or as month-partitioned files produce identical logical results (same columns, same ordered rows).
- **MR-B Regenerability / determinism.** Deleting DuckDB's local compute state (temp directory) changes nothing: the result artifact is derivable from the immutable dataset version + named spec + pinned engine. A re-submit under the **same** idempotency key resolves to the existing job (no re-run); a re-run under a **new** key reproduces the same logical rows as a new result row. This asserts determinism of the derivation, not cross-job artifact reuse.
- **MR-C Workspace binding.** A workspace-bound key for A never reaches B's dataset, across both the register and query paths. The R2 prefix is derived from the authenticated workspace, never from a request value.

Do not generalize these into a broad failure matrix.

### Hidden holdout

**One holdout — subject to explicit owner authorization (AGENTS.md rule 9).** Issue #13 does not name a holdout; the owner is asked in the packet to authorize it. Analytics is where an implementation could hardcode the public fixture's answer or read a stale/partial file set and still return plausible numbers.

`tests/e2e/analytics-holdout.spec.ts` preserves the success claim while changing meaningful scenario details, submitted over **HTTP** (no MCP):

- an **unseen dataset** with different job-type labels and a different number of types;
- a **different partition layout** (a single file plus month partitions, where the public fixture used day partitions);
- a **different date range** crossing a year boundary.

The holdout asserts the result equals the independently computed aggregate and additionally asserts the public fixture's expected numbers do not appear. It hides scenario details, not implementation trivia.

### Production smoke

**Named production wiring acceptance item — W1: wire the analytics engine on gravebuster.** This slice's whole problem is that engines get merged to `main`+`production` and left dark (graph returns `503 GRAPH_NOT_CONFIGURED`; retrieval returns `503 EMBEDDING_PROVIDER_NOT_CONFIGURED`). A green merge with the analytics engine unreachable is **not** acceptance. W1 acceptance (exact artifacts):

- the pinned DuckDB dependency is present in `package.json` and **verified to load** inside the built `octo-api` image (`deploy/gravebuster/Dockerfile.api`, which runs `npm ci`); a native-module load failure fails the item;
- the `analytics_query` job type is **claimable and dispatchable by the deployed worker** — a submitted job reaches `completed` on the host, not `UNKNOWN_JOB_TYPE`;
- the deployed host environment feeds `loadR2ConfigFromEnv()` the R2 variables it reads (`S3_API_ENDPOINT` / `ACCESS_KEY_ID` / `CLOUDFLARE_SECRET_ACCESS_KEY` / `OCTO_R2_BUCKET`, or the `R2_*` fallbacks; add the expected aliases to `deploy/gravebuster/.env.example` and the host `.env` if the current `CLOUDFLARE_R2_*` names do not reach the provider);
- `/health` reports `analytics: { configured: true, engine: 'duckdb', version }` after a restart;
- a designated smoke workspace is provisioned **by the smoke script itself** through the registration route (no manual pre-seeding).

The engine is **embedded** in the existing `octo-api` worker drain path — no new service and no new Dockerfile. The separate `octo-analytics` compose service is a **rejected alternative** the packet records only as an owner decision; W1 assumes the embedded default. `503 ANALYTICS_NOT_CONFIGURED` is the ordinary runtime error when the object store is absent or the native module failed to load — **not** the anti-dark guarantee: graph and retrieval shipped dark with exactly that 503 route shape. The only real anti-dark mechanism is this named wiring item plus the deployed production smoke.

**Smoke script — `scripts/analytics-smoke.ts`** (invoked by the existing `npm run production-smoke` path alongside `src/qa/production-smoke.ts`). Against `OCTO_SMOKE_BASE_URL`:

1. `/health` reports the analytics engine configured;
2. with an env-provided smoke key, register a small known dataset version via `POST /api/workspaces/:id/datasets`, submit `job-failures-by-type-month@1`, poll the job to completion, fetch the result, and assert the known row count/sum.

That is the smallest post-deploy check proving the deployed runtime supports the accepted job.

**Evidence-to-close mapping (issue #13):** catalog/version record → `analytics-catalog.test.ts`; multi-file query output → the end-to-end eval; result artifact record → `analytics-result.test.ts`; cross-workspace denial → `analytics.spec.ts`; bulk rows remain out of operational Postgres → the end-to-end eval's row-count assertion; green `gates` → `scripts/verify-analytics.ts` plus the rest of the `gates` job. **W1 (production wiring) is additional evidence this slice adds, because the engine must not ship dark.**

### Done criteria

A slice is done only when: the accepted user job works end to end; the public deterministic evals pass; the metamorphic evals pass; the holdout passes (if authorized); required repository CI (`gates`) is green on the exact candidate; **the production smoke passes and W1 is satisfied — the deployed analytics job actually executes against R2 and returns the known result**; and no out-of-scope machinery was added.

## Deferred / not in this slice

- **Iceberg, DuckLake, ClickHouse, Spark, an always-on distributed query service, and `pg_duckdb`** — out of scope per #13. DuckDB is embedded, disposable, in-process compute in the existing worker drain path, never a server.
- **Concurrent query workers / a query service.** This slice serializes jobs (one query at a time) and keeps DuckDB compute ephemeral: its state lives in a local temp directory, and nothing durable depends on it. Deleting that directory is a no-op (MR-B).
- **Manifest table, compaction job, orphan sweep, Hive partition discipline beyond the path convention, and a no-per-query-LIST rule** — not built in this slice. Multi-file correctness over the derived path convention is the whole claim; the slice adds no manifest rung and no second dedupe mechanism.
- **User-authored SQL, a SQL console, a BI/chart builder, Power BI/DAX** — out. Octo builds the SQL server-side from named query specs. No new analytics UI: the existing operations/jobs surface already lists the `analytics_query` job and its terminal state; a durable analytics view is slices 4–5.
- **A server-side exporter/checkpoint** that materializes Octo's own operational tables (`octo.jobs`, `octo.activity`, `octo.ops_events`) into Parquet as a product job. The accepted question runs over a **caller-registered** dataset. Octo's control-plane history is **not reachable by any existing product surface**: the Slice 21 SQL route runs as the workspace's own `NOSUPERUSER` role against the workspace's own provisioned database, which holds no `octo` schema and no control-plane grants. A caller's own data in its provisioned database is exportable with existing surfaces; Octo's own operational history is not. An automated exporter is a later, separately accepted slice.
- **Streaming/multipart dataset-part upload** — registration parts arrive as base64 in one JSON body, which is not size-limited in this slice; a large dataset registration is a known limitation. Streaming/multipart upload is a later concern.
- **SDK/CLI analytics clients** — Slice 3. The thin MCP analytics tool is likewise deferred to Slice 3; this slice's client surface is **HTTP only**.
- **New isolation/security machinery** — the existing workspace binding, RLS fence, and workspace-prefix derivation are reused unchanged. No MFA, roles, or policy engine is added.
- **R2 result retention / lifecycle policy** — not promised here.

## Lock

- Owner accepted/corrected: **pending**
- Locked at: **not locked**
- **Wiring/provisioning acceptance (W1) is required in the Lock/Done criteria.** The packet is not done while the analytics engine is merged but dark: the DuckDB dependency must be present and loading in the deployed `octo-api` image, the host environment must feed the R2 provider, `/health` must report the analytics block, and the production smoke must execute the accepted query against R2 and return the known result.

## Decisions for owner review

The packet owns every product decision; this appendix seeks no decision of its own. Eval mechanics only:

1. Confirm the fixtures' exact seeded distributions (job types, months, boundary rows) are implementation detail — the packet fixes the oracle (`octo.jobs WHERE state='failed'`) and the invariants, not the counts.
2. The hidden holdout is subject to the packet's decision 5 (owner authorization); this appendix does not seek separate authorization.
