# Slice 7 — Historical Analytics: Differential Testing

**Status: pending independent critique and owner acceptance. Do not implement until the owner locks the packet on issue #13.**

**Authority: this companion is subordinate to the merged packet `docs/productization/slices/07-historical-analytics.md`. The packet owns the completion oracle and the differential table; where this file and the packet differ, the packet governs.** This file adds the axis-by-axis differential detail — oracle definitions, fixtures, and divergence signals — and nothing else.

## Purpose

Differential testing here means: run the **same logical question** through two **independent paths** and assert the results agree, or that a divergence is explained and intended. It is not example testing (one input → one pinned output) and not metamorphic testing alone (a relation over a family of inputs). It is the eval class that catches a whole-system defect no single-path test can see — a materialization that dropped rows, a reader bound to a physical layout, an engine bump that changed aggregate semantics.

The one accepted question (issue #13, titled "Slice 11" on the issue and Slice 7 per `SLICE_MAP.md`; `draft-packets.md` Slice 7): **job failures by type and month** — the count of failed jobs grouped by `job_type` and UTC calendar month, over a history window materialized as Parquet, in a **caller-registered** dataset. Every axis below uses this same question.

The differential is **producer-agnostic**: it validates whatever produces the dataset — the deterministic test fixture today, a server-side exporter if the owner later accepts one. It does not itself require a product exporter.

## Scope summary

The packet's differential table, with this companion's realization of each row:

| # | Axis | Two paths | In this slice? |
|---|---|---|---|
| 1 | Parquet vs operational Postgres | DuckDB over fixture-materialized Parquet vs a **test-only** direct Postgres query over `octo.jobs WHERE state='failed'`, filtered to the declared window | In scope (gates, `scripts/verify-analytics.ts`) |
| 2 | Repartition invariance | Partitioning A vs B of the same logical rows | In scope (unit, `tests/unit/analytics-metamorphic.test.ts`, MR-A) |
| 3 | Engine-version stability | **Determinism/pin check**, not two independent paths: the pinned DuckDB build re-run on a frozen fixture; the resolved version is recorded in result metadata | In scope (unit, `tests/unit/analytics-metamorphic.test.ts`, MR-B) |
| 4 | Client-path equivalence | HTTP vs MCP | **Deferred** — MCP tool is Slice 3; no operations-UI proxy (this slice adds no new UI) |
| 5 | Incremental vs full materialization | Full vs checkpointed fixture producer | In scope as **test-harness only**; no product exporter |

## What this appendix adds

The packet states the decisions; this file states, per axis, the oracle, the fixture, the invariant, and what a divergence indicates. It adds no product surface, no second gates script, no second fixture module, no client path, and no reporting artifact. Every axis runs through the packet's single fixture module (`scripts/analytics-fixture.ts`) and single gates script (`scripts/verify-analytics.ts`); the draft's separate `scripts/verify-analytics-differential.ts` is folded in and not added.

## Shared conventions

- **Logical result equality is the invariant, not byte equality.** Two results agree when they have the same columns (name and order) and the same rows in the same canonical order. Parquet bytes differ across writers, row-group sizes, and file counts; asserting byte equality across partitionings would be wrong. The result artifact's `contentHash` is recorded for artifact identity only, never as a cross-writer equality claim.
- **Canonical row order** for the accepted question: `ORDER BY job_type, month`.
- **UTC truncation on both sides.** Both paths compute the month as `date_trunc('month', created_at AT TIME ZONE 'UTC')`. The fixture includes rows at exact UTC month boundaries (last instant of a month, first instant of the next) so a timezone or truncation disagreement cannot hide.
- **Declared export window (watermark).** Every dataset version declares the source window it covers. The Postgres-side oracle compares only source rows inside that declared window; without this pin, a row inserted between materialization and compare is a false divergence, not a defect.
- **Engine pin.** DuckDB is pinned to an exact version (no caret) in `package.json`; the resolved version string is recorded as `engineVersion` in result metadata for every run. A version change is a deliberate, recorded event, never silent.
- **Embedded engine, no new CI service.** DuckDB ships as an embedded npm dependency in the existing `octo-api` worker drain path; no new service container is added to `gates.yml`. The gates run needs only the existing Postgres service and the local storage backend.
- **Fixtures are deterministic.** Fixed seed, fixed UUIDs, fixed `created_at` values, fixed job types (for example `archive_file`, `restore_file`), built by the fixture module — never sampled from a live database. A failing case reproduces from the fixture definition alone.
- **Explained divergence is recorded, never waived.** A differential passes only on agreement. Where a divergence is intended (for example a deliberate engine bump, Axis 3), the gates run records the reason alongside the result; an unexplained divergence fails. This is an assertion convention in the existing gates run, not a new reporting artifact, and not a lever to make a failing differential green.
- **Storage backend.** The gates run uses the local object-storage backend (`OCTO_STORAGE_BACKEND=local`) plus the Postgres service, matching `scripts/verify-workspace-query.ts`. Production R2 is exercised by the production smoke, not by every gates run.
- **Gates wiring is part of this slice.** Adding the pinned DuckDB dependency and a step running `scripts/verify-analytics.ts` in `.github/workflows/gates.yml` (against the existing Postgres service and local storage backend) is an expected change to the accepted CI surface. The packet folds the draft's separate differential script into this one; no other CI service is added.

## Fixtures

All fixtures are produced by the packet's single fixture module `scripts/analytics-fixture.ts` (**test scaffolding, not a product exporter**) and are deterministic. They are views of the packet's **Fixture A** (synthetic multi-file Parquet) and **Fixture B** (seeded source history), not new product fixtures.

| Id | Fixture | Purpose |
|---|---|---|
| F1 | Packet Fixture B: a fixture workspace seeded with `state='failed'` `octo.jobs` rows across ≥2 job types and ≥3 calendar months — including exact UTC month-boundary rows, two job types failing in the same month, a month with zero failures for one type, and a non-failed state as a negative control — materialized to Parquet and registered as a dataset version; plus a second workspace with overlapping history. | Axes 1, 3, 5; MR-C |
| F2 | Packet Fixture A: the same logical rows written two ways — (a) one `part-*.parquet`; (b) multiple files under `dt=YYYY-MM-DD` keys (day and month partitions, month partitions normalized to `dt=YYYY-MM-DD`) with smaller row groups. | Axis 2 (MR-A) |
| F3 | F1's logical rows materialized by the fixture producer under a full strategy and a checkpointed-delta strategy, with mutations between checkpoints (new failures, including one row whose `created_at` is older than the prior watermark). | Axis 5 |
| F4 | A frozen Parquet artifact checked in alongside the DuckDB version string it was produced under. | Axis 3 (MR-B) |

Object layout (the packet's SDD owns the convention):

```
workspaces/<workspaceId>/lake/<datasetSlug>/v<versionNumber>/dt=<YYYY-MM-DD>/part-<uuid>.parquet   # dataset versions
workspaces/<workspaceId>/lake/_results/<resultId>.parquet                                          # result artifacts
```

The accepted query spec is the packet's named spec `job-failures-by-type-month@1`; the caller supplies the spec id, never SQL. Both paths submit the same spec against the same `datasetVersionId`.

## Differential axes

### Axis 1 — DuckDB-over-Parquet vs operational Postgres

- **Paths.** P-A (product): DuckDB reads the dataset version's Parquet objects and answers the accepted question. P-B (oracle): a direct query in the test against `octo.jobs WHERE state='failed'`, filtered to the dataset version's declared window, on the trusted test connection. `octo.ops_events` is **not** the oracle: it is per-event and error-code keyed, so it is not one row per failed job.
- **P-B is test-only — state this explicitly.** Slice 21's `POST /api/workspaces/:id/query` runs as the workspace's own `NOSUPERUSER` role against the workspace's own provisioned database, which holds no `octo` schema (`src/server/query.ts`, `src/server/provisioning.ts`); it cannot be the oracle. The operational-Postgres side of this comparison is a direct query in the test, **not a product surface**. A product SQL console over operational Postgres is a scope choice for a later slice, not a contract prohibition (see Scope choices).
- **Fixture.** F1. The export window is declared when the fixture materializes the source rows; the fixture also inserts a row *after* the declared window to prove the watermark excludes it (absent from P-A and not counted by P-B).
- **Invariant asserted.** For every `(job_type, month)` in the window, P-A count equals P-B count; identical columns and identical ordered rows; no `(job_type, month)` cell on one side only; totals agree.
- **Divergence indicates.** The materialization dropped or double-counted history; the watermark is wrong; a month-boundary/timezone disagreement; a job-type or state filter mismatch.
- **Command / pass condition.** `scripts/verify-analytics.ts`, run in gates (Postgres service + local storage backend). Pass = zero differing cells and identical row sets.

### Axis 2 — Repartition invariance

- **Paths.** P-A: F2 partitioning A (single file, single row group). P-B: F2 partitioning B (multiple files under `dt=YYYY-MM-DD`, smaller row groups) — the same logical rows under different physical file boundaries.
- **Fixture.** F2.
- **Invariant asserted.** Same query, same logical dataset, different physical layout → identical logical result (column set, row set, counts). This is #13's "repartitioned equivalent dataset" check.
- **Divergence indicates.** A partition-pruning or file-globbing bug; a reader that assumes exactly one file; a query that depends on the physical path layout. The query must depend on the logical dataset, not its layout (#13: "Partition/path layout is an optimization, not the authorization mechanism").
- **Command / pass condition.** `tests/unit/analytics-metamorphic.test.ts` (MR-A). Pass = identical results across partitionings.

### Axis 3 — Engine-version stability (determinism/pin)

- **Paths.** Not two independent paths. The **pinned** DuckDB build is re-run against frozen fixture F4; the resolved version string is recorded with every run as `engineVersion`.
- **Pin and detection.** DuckDB is pinned to an exact version in `package.json` (no caret); F4 stores the engine version it was produced under. A bump is **detected** because the pin changes: the frozen-fixture equality re-runs against the new build and either matches (safe) or fails (behavior change). A bump cannot pass silently.
- **Fixture.** F4.
- **Invariant asserted.** Same frozen Parquet + same query + same recorded engine version → identical logical result across runs. Counts compare as exact integers (DuckDB `COUNT(*)` is `BIGINT`); no approximate or floating comparison.
- **Divergence indicates.** A dependency updated without recording it, or changed aggregate/date semantics. On a deliberate bump, a divergence is a signal to review and re-record the version and expected result — not automatically a product bug.
- **Deferred.** No side-by-side two-version CI matrix and no pre-emptive sweeps for hypothetical future engine behavior.
- **Command / pass condition.** `tests/unit/analytics-metamorphic.test.ts` (MR-B). Pass = F4 result equals the recorded result at the pinned version.

### Axis 4 — Client-path differential (HTTP vs MCP) — DEFERRED

- **Deferred to Slice 3.** The packet's first client surface is **HTTP only**; the thin MCP tool (`register_dataset`, `query_dataset`, `get_analytics_query_status`, `get_analytics_result`) is deferred to Slice 3, consistent with `SLICE_MAP.md` and issue #13. This slice adds no new UI, so there is no operations-UI proxy and no in-slice client-path differential.
- **When it activates (Slice 3).** P-A submits the accepted question over HTTP; P-B submits the same query through the MCP tool, a thin client of that same route (`src/mcp/server.ts` forwards to `src/mcp/client.ts`; the adapter adds no policy of its own). The invariant is equivalent server semantics and the **same result artifact identity** — the same query spec against the same `datasetVersionId` resolves to the same registered `resultId`, and a re-submission does not duplicate it. This is the `SLICE_CONTRACT` metamorphic example ("SDK, CLI, MCP, and frontend calls that express the same capability should have equivalent server semantics") applied to the two client surfaces.
- **Fixture.** F1.
- **Divergence would indicate.** The MCP tool submits a different query spec, dataset version, or workspace; the adapter duplicates or overrides server policy; result registration is non-idempotent and a second submission created a second artifact.
- **Not a Slice 7 deliverable.**

### Axis 5 — Incremental vs full materialization (fixture producer only)

- **Paths.** P-A: the source history materialized in one shot (full). P-B: the same source history materialized incrementally — a baseline plus checkpointed deltas in the fixture producer — then materialized into one dataset version for the query. This is a **fixture-producer concern only**.
- **Product contract.** The product query contract reads exactly **one** `datasetVersionId`. No multi-version accumulated read is designed, and no product late-arriving-row policy is declared; the product surface does not expose incremental materialization.
- **Fixture.** F3. History mutates between checkpoints: new failures are inserted, including one row whose `created_at` is older than the previous checkpoint's watermark, to exercise late-arriving rows in the fixture rather than assume them away.
- **Invariant asserted.** The incrementally materialized dataset and the full materialization answer the accepted question identically (logical result equality), and the union of materialized rows contains each source row **exactly once** — no loss, no double-count. Each version declares its own export window.
- **Divergence indicates.** A checkpoint that re-exports a row (double-count) or skips a range (loss); a late-arriving row silently dropped; a watermark advanced past unexported rows.
- **In-scope form.** The differential runs against the **fixture producer** (`scripts/analytics-fixture.ts`): a small deterministic export/checkpoint function that materializes the seeded source rows under a full strategy and an incremental strategy. Test scaffolding, not a product exporter.
- **Deferred product exporter.** An automated **server-side exporter/checkpoint** that materializes Octo's own operational tables (`octo.jobs`, `octo.activity`, `octo.ops_events`) into Parquet as a product job is **deferred by the packet** and is not required to run this differential. Do not build it to satisfy this document.
- **Command / pass condition.** `scripts/verify-analytics.ts` (gates). Pass = identical results and exactly-once row coverage.

## EVAL / TDD placement

| Axis | Contract eval class | Where |
|---|---|---|
| 1 | Integration (live cluster + storage) | `scripts/verify-analytics.ts` (gates) |
| 2 | Metamorphic/property | `tests/unit/analytics-metamorphic.test.ts` (MR-A) |
| 3 | Metamorphic/property (frozen fixture) | `tests/unit/analytics-metamorphic.test.ts` (MR-B) |
| 4 | Deferred | MCP client suite, Slice 3 — not a Slice 7 deliverable |
| 5 | Integration (live cluster + storage) | `scripts/verify-analytics.ts` (gates) |

The single fixture module (`scripts/analytics-fixture.ts`) and the single gates script (`scripts/verify-analytics.ts`) serve every axis; the draft's separate `scripts/verify-analytics-differential.ts` is folded in and not added.

## Hidden holdout and production smoke (owned by the packet)

- **Hidden holdout.** The packet owns the single holdout (`tests/e2e/analytics-holdout.spec.ts`), subject to explicit owner authorization under AGENTS.md rule 9. It is submitted over **HTTP** (no MCP) and changes scenario details (an unseen dataset with different job-type labels, a different partition layout, a date range crossing a year boundary) while preserving the success claim; it also asserts the public fixture's expected numbers do not appear. This document adds no second holdout and asserts no conflicting expected numbers.
- **Production smoke.** `scripts/analytics-smoke.ts`, invoked by the existing `npm run production-smoke` path: `/health` reports the analytics engine configured; then, with an env-provided smoke key, register a small known dataset version via `POST /api/workspaces/<id>/datasets`, submit `job-failures-by-type-month@1`, poll the job to completion, fetch the result, and assert the known row count/sum against the deployed R2/DuckDB path (#13 "Verify deployed R2/DuckDB"), not a local stub. W1 (production wiring) governs.

## Deferred / not in this slice

- **Executable HTTP-vs-MCP differential** — Axis 4 activates with Slice 3 (the MCP tool is not in this slice).
- **A product server-side exporter/checkpoint** that materializes Octo's own operational tables into Parquet as a job — deferred by the packet. Axis 5 runs against the fixture producer only.
- **Cross-version DuckDB matrix** — only on a deliberate, recorded version bump.
- **BI tool / DAX reimplementation, Iceberg, ClickHouse, Spark, an always-on distributed query service, and duplicating analytical rows into Postgres** — #13 out of scope.
- **Corrupt/schema-mismatched data, timeout/cancellation, cross-workspace denial, retry-without-duplicate-result-registration** — single-path failure and authorization checks, not differentials; they belong to the packet's EVAL/TDD section, not this document.

## Scope choices (not contract prohibitions)

- **A product SQL console over operational Postgres** is out of scope here because the accepted job does not need one. This is a **scope choice, not a contract prohibition**: neither issue #13 nor `SLICE_CONTRACT.md` forbids it. Slice 21 already provides raw SQL over a workspace's **own** provisioned database (`POST /api/workspaces/:id/query`); this slice does not rebuild, wrap, or duplicate it. Axis 1's Postgres path must remain a test-only oracle; a product query surface over operational `octo` data would be a separate, owner-approved slice.
- **Always-on DuckDB or distributed query machinery** — DuckDB is disposable compute (#13: "DuckDB compute state is disposable").
- **Parquet byte equality as the cross-path invariant** — the invariant is logical result equality; byte equality is not asserted across writers or partitionings.

## Lock

- Owner accepted/corrected: **pending**
- Locked at: **not locked**

## Decisions for owner review

1. Confirm the differential axes are part of the accepted Slice 7 completion oracle (the axes are the primary evidence for #13's "did not drop or double-count history" and "repartitioned equivalent dataset" claims).
2. Confirm Axis 5 runs against the **fixture producer** while a product server-side exporter stays deferred — the differential does not pull the exporter into scope.
3. Confirm Axis 1's operational-Postgres side is a **test-only oracle**, and that a product SQL console over operational Postgres is a scope choice for a later slice, not a contract prohibition.
