# Slice 7 — Historical Analytics (PDD)

**Status: PDD companion draft. Not locked. The authoritative document is the merged locked-format packet `docs/productization/slices/07-historical-analytics.md`; where this companion and the packet differ, the packet wins. This file is subordinate to the packet and is kept as a PDD-depth appendix. Do not implement until the owner locks the packet on issue #13.**

Owning issue: #13 (OCTO-1100, "DuckDB and Parquet analytical workspace over R2 datasets"), aligned to Slice 7 of `SLICE_MAP.md`. Robustness target: **Level 2**.

## PDD

**User / actor:** An authenticated agent or human working in a workspace that holds a large/tabular dataset it has already materialized as Parquet objects, and that needs to answer a long-range aggregate question over it. The canonical example is **job failures by type and month**, answered over a dataset **the caller registers** — not over Octo's own control-plane history.

**Job:** Register a multi-file Parquet dataset (with its schema and provenance) into a workspace, run one named analytical query over it with DuckDB through an Octo-controlled job, and fetch the result artifact — without loading bulk analytical rows into operational Postgres and without the caller ever holding R2 master credentials.

**Why now:** `PROJECT.md` promises Parquet for long-term operational, observational, and analytical history and DuckDB for analytical queries over it, but the repository contains no DuckDB/Parquet code and issue #13 is open. Adopters have been told analytics runs on "Octo's DuckDB and Parquet" and found neither existed (#149); another agent bypassed Octo's managed layer entirely (#162). The recurring failure is reading merged roadmap prose as shipped capability. This slice makes the analytical path real, and states plainly what it does not deliver.

**The worked example.** The accepted question is `job-failures-by-type-month@1`, answered over a dataset **the caller registers** — not over Octo's own control-plane history. The registered dataset carries input columns `(job_type TEXT, state TEXT, created_at TIMESTAMPTZ)`; the result has exactly the columns `(job_type, month, failure_count)`. The caller uses four HTTP routes — `POST /api/workspaces/<id>/datasets`, `POST /api/workspaces/<id>/analytics/queries`, `GET /api/workspaces/<id>/analytics/queries/<jobId>`, and `GET /api/workspaces/<id>/analytics/results/<resultId>` — registering a dataset version (`datasetVersionId`), submitting the named spec, and fetching the result artifact (`resultId`). HTTP is the only client surface in this slice; the thin MCP tool is deferred to Slice 3.

**In scope:**

- **Dataset/version catalog** in control-plane Postgres: workspace, logical dataset, immutable version, `format`, schema, R2 object-key list, and provenance. A re-export is a new version, never a mutation.
- **Parquet object conventions in R2:** a workspace-scoped key prefix and a dataset/version path layout. Partition/path layout is an optimization, never the authorization mechanism.
- **A DuckDB query job:** DuckDB reads the dataset's Parquet objects directly from R2, runs one **named** query spec, and writes a result Parquet artifact back to R2. DuckDB is ephemeral, in-process compute in the existing `octo-api` worker drain path — no separate service and no persistent DuckDB file.
- **Result artifact registration and fetch:** the result Parquet's key and metadata are recorded against the workspace and fetched through a dedicated analytics result route.
- **Workspace authorization:** the existing scoped-key binding and membership checks apply. A caller in another workspace cannot register, query, or read a dataset/result. The server holds the R2 credentials; the caller never receives them.
- **The client-facing submit path:** an authenticated HTTP surface that enqueues one reserved analytics job type through the existing jobs queue (the same enqueue/idempotency/lease contract) and returns the job id.

**Out of scope:**

- Iceberg, ClickHouse, Spark, `pg_duckdb`, or any analytical engine beyond DuckDB.
- An always-on distributed query service; DuckDB stays in-process and disposable.
- A BI/DAX product or Power BI platform reimplementation.
- Duplicating bulk analytical rows into operational Postgres.
- A general SQL console. A raw-SQL surface over a workspace's **own provisioned database** already exists as Slice 21 (`POST /api/workspaces/:id/query`); this slice does not rebuild, wrap, or duplicate it.
- A new analytics UI. The existing operations/jobs surface already shows the query job and its terminal state; the workspace shell is slices 4–5.
- User-authored SQL. The caller submits a named spec id; the server builds the SQL.

**Deferred / not in this slice:**

- **No server-side exporter/checkpoint** that materializes Octo's own operational tables (`octo.jobs`, `octo.activity`, `octo.ops_events`) into Parquet as a product job. This slice answers the accepted question over a **caller-registered** dataset. Octo's control-plane history is **not reachable by any existing product surface**: the Slice 21 SQL route runs as the workspace's own `NOSUPERUSER` role against the workspace's own provisioned database, which holds no `octo` schema and no control-plane grants (`src/server/provisioning.ts`, `src/server/query.ts`). A caller's own data in its provisioned database is exportable with existing surfaces; Octo's own operational history is not. An automated exporter is a later, separately accepted slice.
- **Partial roadmap delivery, stated plainly:** `PROJECT.md`'s Parquet/DuckDB promise is only **partially** delivered here. This slice delivers a working DuckDB-over-Parquet engine and a caller-registered dataset path. It does **not** deliver the "exported history" pipeline that would make Octo's own operational history queryable, nor any BI surface. Roadmap prose must not be read as shipped capability beyond this.
- **No BI/analytics connector** (issue #13's "optional BI connection later" is not taken up here).
- **No partition-pruning or performance guarantee.** Multi-file correctness is the claim; layout is a convention.
- **No list-versions, delete-dataset, or catalog-browsing endpoints** beyond what the accepted job strictly needs.
- **No SDK/CLI or MCP analytics client** — Slice 3.
- **No large-object streaming or presigned direct upload.** Registration parts arrive as base64 in one JSON body, which is not size-limited in this slice; a large dataset registration is a known limitation. Streaming/multipart upload is a later concern.

**Reuse:**

- Existing R2 client (`src/storage/r2-client.ts`) for reading dataset objects and writing/presigning result artifacts.
- Existing jobs queue: enqueue/run, leases, idempotency, retries, ops events (`src/jobs/job-service.ts`, `src/jobs/worker.ts`, `src/server/index.ts`). The analytics job is one more reserved job type dispatched by the existing worker, which already fails an unregistered type.
- Existing scoped-key authorization and workspace binding (`requireScope`, `keyWorkspaceMatches`, membership checks) and control-plane metadata helpers (`src/server/db.ts`).
- Existing capabilities catalog (`src/api/capabilities.ts`) for the four analytics descriptors, and the existing migration/RLS pattern (Slice 14 fence; `tests/test_slice21_schema.py`).

**Observable success:**

- A caller-registered multi-file Parquet dataset with input columns `(job_type TEXT, state TEXT, created_at TIMESTAMPTZ)` answers `job-failures-by-type-month@1` through the HTTP job API. The result Parquet has exactly the columns `(job_type, month, failure_count)` and rows equal to the aggregate computed **independently** in the test from the same registered rows, with `month = date_trunc('month', created_at AT TIME ZONE 'UTC')` and canonical order `ORDER BY job_type, month`.
- The result artifact is registered and re-fetchable through `GET /api/workspaces/<id>/analytics/results/<resultId>`; re-submitting under the same idempotency key returns the same job and does not create a duplicate result.
- A key bound to another workspace is refused (`403`); a `datasetVersionId`/`resultId` not in the caller's workspace resolves to `404` with no existence leak.
- Operational Postgres row counts and schema show only dataset/version/job/result metadata — bulk analytical rows never entered it.
- On the deployed runtime, the analytics job actually executes against R2 and returns the known result (production smoke; W1).
