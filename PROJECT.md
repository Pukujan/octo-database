# Octo — Project Contract

<!-- continuity:project {"id":"octo-database","protocol_version":"0.1.0-draft","schema":"project-continuity.project.v1","title":"Octo"} -->

## Main goal

Build a reusable self-hosted workspace data platform where people, applications, and scoped agents can keep important state durable, remotely accessible, and reconstructible without depending on one local machine.

Octo provides one workspace-oriented capability API over mature databases, storage systems, analytics engines, and external authorities. It should glue existing systems together rather than rebuild weaker copies of them.

## Product model

A workspace uses only the capabilities it needs.

- PostgreSQL — live relational and transactional state.
- pgvector — optional vector search/projection.
- Neo4j or another graph database — optional graph projection.
- Parquet — long-term operational, observational, and analytical history.
- DuckDB — analytical queries over Parquet and other analytical data.
- Cloudflare R2 — hot/application-serving object storage when useful.
- Google Drive — large, cold, archival, or rarely accessed files.
- Git/GitHub — source code and repository-owned project continuity.

The Octo server owns the workspace contract: identity, authorization, capability discovery, storage routing, synchronization, jobs, projections, analytics access, agent proposals, and execution of approved actions.

Applications consume the HTTP API or a thin typed SDK. Agents consume the same capabilities through an MCP/CLI adapter. Deep infrastructure administration remains in mature provider/native consoles.

## Durable-state principle

A local machine is a working environment and cache, not the only home of valuable state.

Every important local artifact should be one of:

- canonical elsewhere and re-fetchable;
- synchronized to durable storage;
- derived/rebuildable; or
- intentionally ephemeral.

If a machine disappears, a fresh machine should be able to authenticate, restore or reconstruct the important working environment, fetch durable state, clone authoritative repositories, and rebuild caches/indexes.

## Delivery principle

**Optimize for usable end-to-end delivery.**

Existing implementation code is disposable. Accepted user behavior, durable state, data ownership, and useful contracts are not.

Before building something custom, check whether a mature system already provides it. Prefer configuration, integration, and glue code.

Do not add speculative architecture, generalized policy systems, extra security/privacy machinery, compliance layers, abstractions, or future-proofing unless the owner explicitly asks for them or they are strictly required for the accepted user job to function.

Build vertical slices:

system requirement → user job → capability/API → frontend flow → automated user-flow verification → ship

A feature is not complete because the code compiles or an isolated backend test passes. It is complete when its intended user job works end to end without the owner rescuing the experience.

## Frontend principle

Octo's frontend is a coherent workspace portal, not a replacement for every connected system.

Custom product UI focuses on:

- workspace overview and cross-system summaries;
- files/gallery and personal-data workflows;
- agent proposals, simulations, review, and approval;
- workspace-specific actions and recovery/sync flows.

Mature systems retain specialized interfaces for database administration, analytics/BI, graph exploration, GitHub, and provider administration.

Do not prescribe a frontend framework, component library, design tool, or fixed visual system. The owner may use interchangeable design systems and prefers dark mode by default. Keep the frontend focused on Octo's workspace jobs and existing API; leave implementation and visual exploration choices open to the owner and the selected design tool. Mature external consoles/tools remain available for deep database, analytics, graph, and provider workflows.

## Client contract

The stable product boundary is the workspace capability API, not any individual SDK.

Expected client family:

HTTP/JSON API → typed TypeScript SDK → CLI → MCP/agent adapter

The SDK and MCP adapter are thin clients. They must not duplicate server policy or receive master provider/database credentials.

## Product success

Octo succeeds when a fresh user, application, or agent can authenticate to a workspace, discover its allowed capabilities, and reliably use them.

A successful workspace can:

1. keep live application and operational data durable;
2. store and retrieve files regardless of physical storage tier;
3. retain useful operational/observational history for long-term analysis;
4. add vector, graph, or analytical projections when the workspace needs them;
5. let applications consume capabilities through a stable API/SDK;
6. let agents read, analyze, simulate, and create bounded proposals through the same workspace contract;
7. require separate human authority only for actions explicitly designated as human-approved;
8. restore or reconstruct valuable agent/user state while rebuilding disposable local state;
9. expose important user jobs through a frontend usable without the owner explaining how it works; and
10. reuse mature systems rather than rebuilding incomplete substitutes.

## Productization contract

Every major capability must survive the full path:

system requirement → user job → durable backend capability → API contract → usable frontend → automated user-flow verification

If that chain breaks, the capability is not productized.

### Global invariants

These apply across slices:

- every durable Octo-owned object belongs to a workspace;
- browsers and agents never receive master infrastructure credentials;
- canonical/derived/cache ownership is explicit;
- durable state is recoverable or reconstructible from its declared authority;
- required repository CI must pass on the exact candidate being merged;
- production promotion uses the repository's established production branch/runtime path;
- reuse-before-build applies before custom infrastructure/admin/frontend work.

### Slice success conditions

Do **not** attempt to encode one complete product oracle before implementation.

Each accepted slice defines:

- the user job;
- in-scope capabilities;
- authoritative data/storage ownership;
- API contract;
- visible frontend flow when applicable;
- public deterministic acceptance tests;
- targeted metamorphic/property tests for important invariants;
- a small hidden/holdout user-flow evaluation where overfitting or false completion is plausible;
- production verification appropriate to that slice.

Hidden holdouts and metamorphic tests are not universal ceremony. They are required only where the owning slice explicitly names them as part of its success condition.

## Verification philosophy

Tests exist to prevent false completion, not to maximize test count.

Use the cheapest test that proves the accepted claim:

- unit/contract tests for deterministic logic;
- integration tests for provider/database glue;
- Playwright or equivalent for real user jobs;
- metamorphic/property tests for invariants that should hold across changed inputs;
- hidden holdouts for end-to-end success conditions agents could otherwise overfit;
- production smoke checks for the deployed runtime.

Subjective visual/UX quality is not machine-provable. Use competing frontend prototypes, fixed design-system constraints, heuristic/accessibility checks, real task completion, and owner taste veto rather than pretending CI can score beauty.

## Existing infrastructure to preserve and reuse

The current working R2 integration, Google OAuth/login, Google Drive OAuth/storage integration, production deployment path, database migrations, and proven storage lifecycle behavior are assets to reuse unless a new slice demonstrates that replacement is simpler.

Do not rewrite working provider integration merely to conform to a new frontend or SDK shape. Adapt it behind the workspace API.

## Stack responsibilities

Octo owns product requirements and slice success.

- PCM owns execution continuity, task/checkpoint projection, and repository delivery progression.
- CGM owns human-facing content/visual routing and design/content guidance.
- ACS owns hot-loading and runtime agent behavior/gates.
- OIO owns standardized issue intake, filer stamping, and issue classification.
- agent-stack-train owns compatible version pins.

None of those helper repositories owns Octo's product oracle.

## Current program direction

The immediate program is a productization reset:

1. preserve/reuse proven backend/provider integrations;
2. define and stabilize the workspace capability/API contract;
3. add thin SDK/CLI/MCP clients over that contract;
4. select/build the product frontend through a bounded UX/design bakeoff;
5. migrate only useful existing product behavior into the new shell;
6. deliver subsequent capabilities as end-to-end vertical slices.

Issue #72 and its working notes contain the active architecture discussion until this contract is superseded by an explicit owner correction.
