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
