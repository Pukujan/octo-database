# Octo — Project Contract

<!-- continuity:project {"id":"octo-database","protocol_version":"0.1.0-draft","schema":"project-continuity.project.v1","title":"Octo"} -->

## Main goal

Build a reusable self-hosted control plane that gives people and scoped agents one login, workspace model, file catalog, storage router, job surface, and API across personal, family, work, research, and project-specific applications.

## Product shape

The stable core owns identity, authorization, workspaces, file metadata, routing policy, jobs, audit events, and capability discovery. PostgreSQL/Supabase is the canonical operational store. Cloudflare R2 is the active object layer. Google Drive is the archival object layer. Optional per-workspace capabilities may add pgvector, an epistemic schema, Neo4j graph projections, and DuckDB/Parquet analytics.

## Development principle

Architect for replacement; implement for today. Build vertical slices that are useful end to end. Advanced infrastructure is introduced only when a slice has a concrete requirement.

## Canonical progression

GitHub issues own scope, acceptance, dependencies, lifecycle, and durable progression. Repository continuity documents are synchronized projections. Merged default-branch history owns accepted code and project documents.

Program issue: https://github.com/Pukujan/octo-database/issues/1

## Current release target

The first usable path is:

Google login → workspace → upload to R2 → gallery thumbnail/open → scoped read-only share → Drive archive → restore → job/activity visibility.

## Project-level success conditions

The first major milestone is complete only when a fresh browser session can traverse the full v1 path:

Google login → authorized workspace → upload image → thumbnail/gallery → full image view → logged-out read-only share → revoke share → archive R2→Drive → restore Drive→R2 → view again → inspect job/activity evidence.

The milestone also requires:
- cross-workspace negative tests with zero unauthorized disclosure;
- no master storage/database credential in browser or agent surfaces;
- canonical state recoverable from PostgreSQL plus durable object storage;
- retry/restart behavior that converges without duplicate destructive effects;
- required repository gates and evidence green on the exact merged candidates;
- unresolved caveats recorded explicitly rather than hidden behind a completion claim.

## Scope control

GitHub issue #1 is the program authority. Slice issues own their acceptance criteria and explicit in/out-of-scope boundaries.

- A later slice may prototype independently, but it may not redefine an earlier canonical boundary without an explicit accepted issue correction.
- Deferred infrastructure is not introduced because it is fashionable or convenient; it requires a measured need captured in an issue.
- New databases, queues, orchestration systems, canonical owners, or security-boundary changes require an issue-level decision before implementation.
- Planning/specification documents are projections of accepted issues, not a second roadmap.
- If implementation reveals a scope conflict, stop the affected path, record the conflict on the owning issue, and resolve authority before continuing.

## Security invariants

- Every durable user object belongs to a workspace.
- Authorization is checked before storage/data access.
- Browsers and agents never receive master infrastructure credentials.
- Secrets never enter Git, issues, PR prose, transcripts, or ordinary logs.
- Agent identities use scoped Octo capabilities.
- Operator access is separable from private-content access.
- Derived graph/vector/analytics indexes may be rebuilt from canonical state unless an accepted issue explicitly changes ownership.

## Non-goals for the first release

- public SaaS multi-tenancy;
- Kubernetes;
- Kafka;
- a distributed database;
- mandatory Neo4j/GraphRAG;
- mandatory analytics lakehouse infrastructure;
- zero-knowledge encryption;
- recreating a general-purpose cloud provider.
