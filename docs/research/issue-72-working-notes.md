# Issue #72 working notes

> Working scratchpad for the owner's architecture discussion. Non-binding. This is a compact memory of the conversation, not a design decision or implementation mandate.

## Why this file exists

The discussion around issue #72 is broader than "which database dashboard should Octo use?" The owner is trying to define a durable data home for projects, agents, applications, personal files, analytics, and AI-assisted organization without rebuilding mature infrastructure.

This file should be updated as the discussion continues. The GitHub issue should stay concise and link here rather than becoming a transcript dump.

## Current requirements understood

### 1. Project continuity and agent continuity are different

For software projects using PCM:

- GitHub/Git owns source code and accepted project history.
- PCM keeps project working state in the repository: tasks, HANDOFF, checkpoints, AGENTS guidance, etc.
- A temporary local worktree can be recreated after loss of a machine.

What is *not* recreated by cloning a project repository is the user's agent/Hermes environment:

- user preferences and identity/configuration
- durable memories
- custom skills
- useful transcripts
- agent/tool configuration
- learned project associations
- other non-reconstructible personal agent state

This agent-specific state is worth syncing to persistent storage so losing a Mac does not destroy it. Local state can remain a fast working copy; the persistent copy is for durability/recovery.

### 2. Ownership must be explicit

The system needs a clear answer to "who owns the canonical copy?"

Current working model:

| Data | Likely authority |
| --- | --- |
| Project source code | Git/GitHub |
| PCM project state/checkpoints | Project Git repository |
| Temporary worktrees/caches | Local/reconstructible |
| Hermes user profile/config | Persistent personal store |
| Hermes memories | Persistent personal store |
| Custom skills | Persistent/versioned store |
| Important transcripts | Persistent store/archive |
| SaaS operational records | Production database |
| Photos/videos/documents | File/object storage |
| Large historical/analytical records | Parquet + analytical engine |
| AI-proposed changes | Durable proposal store until approved/expired |

The goal is not to copy everything everywhere. Canonical, derived, cached, and reconstructible data should be distinguished.

### 3. Personal data home

The owner wants personal photos, videos, documents, project assets, and other files to live durably off the laptop, organized by predetermined rules/folders and accessible from anywhere.

The database can hold metadata, ownership, logical IDs, relationships, tags, and storage pointers while large file bytes live in object/file storage.

A storage policy may separate frequently used files from large or rarely used files. Large/cold files may live in Google Drive and be fetched on demand; a faster object store such as R2 may be optional rather than mandatory.

### 4. SaaS/application data

Applications that serve many users still need a proper operational database for high-frequency structured data such as users, permissions, subscriptions, records, transactions, etc.

Large uploads/media should not live as huge blobs inside the operational database; the DB should reference their external storage location.

### 5. Agent/inference workspace

The owner wants agents to be able to work *inside a bounded workspace* with enough read/query access to understand the workspace and improve its organization.

The desired behavior is not unrestricted autonomous mutation:

1. agent receives a workspace-scoped credential
2. agent reads/query/analyzes allowed data
3. agent simulates proposed changes
4. proposal is persisted durably
5. owner reviews/discusses it
6. execution requires a separate human approval that the agent cannot reproduce
7. only the exact approved proposal is executed

Examples:

- reorganize folders/files
- merge duplicates
- change metadata/tags
- archive old material
- restructure project categories
- propose operational improvements from historical data

### 6. Human-only execution authority

A normal agent/workspace key should be able to authorize analysis and proposal creation but not destructive/high-impact execution.

Execution should require a separate human-bound approval mechanism. The owner's current direction is stronger than another copyable API secret: e.g. passkey/WebAuthn/security-key/MFA-backed approval.

Conceptually:

```
agent workspace key
  -> read / query / analyze / simulate / propose

human approval
  -> authorize proposal N exactly
  -> server verifies approval
  -> execute
```

The agent should not be able to mint or duplicate the human approval factor.

### 7. Proposal lifecycle / temporal behavior

AI proposals should be first-class durable records rather than transient chat output.

Useful temporal fields may include:

- created_at
- valid_from
- valid_until
- approved_at
- executed_at
- superseded_at / expired_at

An expired or superseded proposal should become historical evidence, not remain executable authority.

### 8. Analytics inside each workspace

The owner wants long-term operational and observational data to be analyzable by both humans and agents.

Examples:

- which files have not been touched for years?
- which projects consume the most storage?
- which agent workflows repeatedly fail?
- how did folder/project organization evolve?
- which observations eventually became implemented work?
- what patterns in app/workspace usage should change future organization?

Working model:

- live/current operational state -> normal database
- large historical/event data -> Parquet
- long-range analytical queries -> DuckDB or compatible analytical service
- agents can query the analytical layer when preparing proposals

This is intended to make a workspace smarter over time, not just provide a business-dashboard feature.

### 9. Fast agent operation vs durable synchronization

Hermes/coding agents may need extremely fast local access while actively working.

Therefore "durable home" does not necessarily mean "every read/write goes over the network."

A possible model is:

```
persistent canonical/synced state
        <- sync ->
local hot working copy
```

Sync policy should be defined by data class rather than blindly syncing every byte/event:

- immediate sync
- end-of-session sync
- periodic sync
- archive-only
- reconstructible/no sync

The exact sync boundaries are still undecided.

### 10. Disposable local machines / regenerable workspaces

The central goal is to eliminate most dependence on local storage. A laptop or workstation should be treated primarily as disposable compute plus a hot local cache.

Important state should live durably in the server-side data environment or in another explicit upstream authority, and local state should be either synchronized or reproducible on demand.

The "server database" should be understood as a data environment rather than one physical database engine. Different capabilities may include:

- PostgreSQL for live relational/transactional state
- pgvector for vector search where appropriate
- Parquet for large historical/analytical datasets
- DuckDB (or a compatible hosted service) for analytics over Parquet and other data
- Neo4j or another graph database for graph projections where a graph model is useful
- file/object storage for large binary content
- Git/GitHub as the authority for source code and repository-owned PCM state

The desired recovery property is: if a Mac disappears, a new machine can authenticate, reconstruct local tools/workspaces, rehydrate needed data, clone authoritative repositories, and fetch or regenerate local indexes/caches without losing valuable state.

Local persistence should therefore be the exception. Every local artifact should ideally be classified as one of:
- canonical elsewhere and re-fetchable
- synchronized to durable storage
- derived/rebuildable
- intentionally ephemeral

This is broader than "move files to the cloud": the goal is to make the working environment portable and regenerable while allowing each workspace to choose the data engines it actually needs.


### 11. Frontend boundary: shell, not replacement consoles

The owner is dissatisfied with the current frontend: it feels like a basic/toy control panel and does not provide the quality of dashboard/analytics experience originally expected.

The desired correction is not simply "polish Dashboard.tsx." The repository already has a reuse-before-build rule in AGENTS.md: mature OSS/provider surfaces should own generic infrastructure administration; custom UI should exist only for workspace/user workflows that are specific to this system.

Working frontend boundary:

- keep a custom workspace shell/home
- keep custom file/gallery experiences where the workflow is unique
- keep custom agent proposal/review/approval surfaces
- keep useful workspace overview, recent activity, storage summaries, and links
- use mature database consoles for database administration
- use mature analytics/dashboard software rather than recreating BI/chart builders
- use native graph tooling for graph administration/exploration where appropriate
- prefer deep links or embedding/glue over rebuilding those tools
- do not keep expanding the current monolithic dashboard simply because a feature needs a screen

The frontend should feel like a coherent workspace portal that composes mature systems, not a homemade replacement for every system it connects.


### 12. Frontend approach — owner-selected

The owner removed framework, component-library, design-tool, and fixed-design-system requirements on 2026-10-03. Dyad and other selected tools have freedom to choose the frontend implementation. Octo's workspace jobs and API remain the product boundary; dark mode is preferred by default and design systems should remain interchangeable.

### 13. Operational data vs analytical data

The workspace needs two related but different data paths.

**Operational data** is the live state used to run the system: current users, jobs, files, agent state, proposals, application records, statuses, and recent events. This belongs primarily in PostgreSQL (and other live operational stores only when a workspace explicitly needs them).

**Analytical data** is the long-range history used to understand the system over time. Operational/event history can be periodically exported or compacted into Parquet and queried with DuckDB. This should not require the live transactional database to become the long-term analytical warehouse.

Working flow:

```
live app / agent operations
        ↓
PostgreSQL current state + event records
        ↓ periodic export / compaction
Parquet historical datasets
        ↓
DuckDB analytical queries
        ↓
dashboards / humans / agents
```

DAX is not a general requirement for this architecture. Power BI should remain an optional downstream analytics client rather than a core Octo dependency. If a workspace later needs Power BI, it can consume the same curated analytical data/semantic definitions without changing Octo's storage or analytics foundation. DAX is Microsoft's formula/query language for Power BI / Analysis Services semantic models. If Power BI becomes a selected analytics frontend later, DAX may be useful inside that tool. For the core workspace analytics path, SQL + DuckDB over Parquet is sufficient initially.

A semantic/metrics layer may become useful later if many dashboards/agents need the same named business metrics (for example, one authoritative definition of "active workspace", "failed run rate", or "storage growth"). Do not introduce one until repeated metric-definition drift becomes a real problem.

The initial operational-data requirement is therefore:
- reliable live state in PostgreSQL
- appendable operational/event history where useful
- periodic or threshold-based export to Parquet
- DuckDB access for long-range analysis
- no requirement for DAX unless Power BI is deliberately adopted


### 14. Consolidated target architecture and glue contract

The working target is one workspace-oriented server API with multiple thin clients rather than separate bespoke integration logic for every app or agent.

**Core data plane**
- PostgreSQL: live relational/transactional state and workspace catalog
- pgvector: optional vector projection/search
- Neo4j or another graph database: optional graph projection
- Parquet: long-term operational/observational history
- DuckDB: analytical queries over Parquet and other analytical data
- R2: hot/app-serving object storage where needed
- Google Drive: large/cold/rarely used file storage
- Git/GitHub: code and repository-owned project continuity

**Server role**
The server owns workspace identity, authorization, routing, sync/orchestration, file placement, projections, analytics access, jobs, proposals, and human-approved execution. It presents one stable capability contract even when the backing provider differs.

**Client surfaces**
- Web frontend uses the workspace API.
- Applications use a typed SDK generated/wrapped around the same API.
- Agents use the same capabilities through an MCP adapter and/or SDK/CLI.
- Provider-native consoles remain available for deep infrastructure administration.

A likely interface family is:

```
HTTP/JSON workspace API
        ↓
typed TypeScript SDK
        ↓
CLI
        ↓
MCP server / agent adapter
```

The SDK should be thin: authentication, typed requests, retries/pagination where useful, and capability discovery. It should not duplicate server policy.

The MCP layer should translate agent tool calls into the same workspace capability API rather than gaining separate infrastructure credentials.

**Frontend approach**
The owner has removed framework, component-library, and design-tool requirements. The owner selects the implementation and visual system. Prefer dark mode by default and allow interchangeable design systems. Octo product requirements remain the workspace jobs and stable API; specialist consoles stay available for deep database, analytics, graph, and provider administration.

**Success condition**
A fresh machine or agent can authenticate to a workspace and:
1. discover its allowed capabilities;
2. fetch/rehydrate needed state;
3. operate on live data/files through the same API contract;
4. query analytical history when permitted;
5. propose changes without gaining human execution authority;
6. open the product frontend and complete the important user jobs without owner rescue;
7. deep-link into mature specialist tools when deeper administration is needed.

The local machine remains a cache/working environment; valuable state is durable or reconstructible elsewhere.


### 15. Delivery strategy: aggressive code replacement, strict scope discipline

The owner does not treat existing implementation code as sacred. If replacing or deleting current code is the fastest path to a coherent product, that is acceptable.

The constraint is not code preservation; it is **scope control and usable delivery**.

Working rules:

- Preserve accepted data contracts, user jobs, durable state, and proven behavior when still relevant.
- Do not preserve a frontend/backend implementation merely because it already exists.
- Prefer mature systems and glue code over custom reimplementation.
- Build one vertical slice at a time from user job -> API capability -> frontend flow -> automated task test.
- A slice is not done because code compiles; it is done when the intended user job works end to end.
- Security/privacy/hardening beyond existing provider/framework defaults and explicit repository invariants is out of scope unless the owner asks for it or a concrete functional blocker requires it.
- Agents must not introduce speculative roles, policy engines, extra approval systems, isolation layers, scanners, compliance machinery, or generalized abstractions while trying to "make it safer."
- Agents may replace old code aggressively, but may not invent new product scope.
- Every implementation decision should answer: "Does this directly help the accepted user job work sooner and more reliably?"

Proposed delivery loop:

```
accepted user job
      ↓
reuse check
      ↓
API capability / contract
      ↓
frontend/design-system implementation
      ↓
automated user-flow test
      ↓
fix until usable
      ↓
ship slice
```

If a mature system already satisfies a step, integrate it rather than reproducing it.


### 16. Architecture lock and execution handoff

The architecture discussion is now reflected in `PROJECT.md` and implementation planning continues in issue #74.

Locked process decision:

- `PROJECT.md` owns global product purpose, boundaries, durable-state principles, and cross-slice invariants.
- Each vertical slice owns its own compact PDD/SDD/TDD-style success condition in the live GitHub issue and linked docs as needed.
- Do not design one giant hidden oracle for the whole product in advance.
- Public deterministic tests prove known contracts.
- Targeted metamorphic/property tests prove slice invariants.
- A small hidden holdout is used only where an agent could plausibly overfit or falsely claim end-to-end success.
- Production smoke verification closes the slice where deployment behavior matters.
- Existing working R2, Google OAuth/login, Google Drive integration, storage lifecycle, CI, and production deployment are reused behind the new workspace API unless a slice demonstrates a simpler replacement.

Helper-stack proposals:
- ACS #57: productization/reuse/done-claim runtime discipline.
- CGM #50: frontend/content surface routing.
- PCM #228: preserve slice success references without owning the product oracle.
- OIO #16: record productization failures without owning acceptance.
- agent-stack-train should move pins only after compatible helper releases actually ship.


### 17. Spec authority and the overbuilding failure pattern

#### Who decides PDD / SDD / TDD

The owner retains product authority.

Working authority split:

- **Owner:** decides the problem worth solving, intended user, product tradeoffs, unacceptable compromises, and what "good enough" means.
- **Strong planning model:** converts owner intent into a concrete PDD/SDD/TDD draft with user jobs, API/system boundaries, acceptance criteria, test strategy, and explicit unknowns.
- **Independent critic/reviewer:** challenges ambiguity, missing cases, hidden scope expansion, and weak success criteria.
- **Implementing agents:** execute the accepted contract; they do not redefine success to match what they happened to build.

Flow:

owner intent → strong-model draft → independent critique → owner accept/correct → locked slice contract → implementation

The owner should not have to manually author detailed specifications. The model should do that translation work, while the owner keeps decision authority.

#### Evidence note

External research supports the broader engineering risks behind this concern, but not a universal claim that coding agents specifically overbuild security.

- DORA recommends small batches because they shorten feedback loops and reports that AI adoption can increase delivery instability unless paired with strong delivery fundamentals and user-centricity.
- NIST usable-security research explicitly warns that security controls can become so burdensome that users circumvent them.
- USENIX research has documented organizational cultures that create an artificial trade-off between security and usability.

Therefore, treat "agents overbuild hypothetical security/edge cases" as an **observed Octo/agent-workflow failure mode and working hypothesis**, not as a settled general empirical fact about all coding agents.

#### Anti-pattern: defensive completeness that destroys product delivery

A recurring agent failure mode is optimizing for hypothetical failure, security, privacy, abstraction, or extreme edge cases until the main product flow becomes late, awkward, or unusable.

Typical symptoms:

- adding generalized policy/permission machinery before the core job works;
- designing for rare failure modes before validating the common path;
- expanding security/privacy scope beyond explicit requirements;
- creating abstractions for hypothetical future use instead of integrating the mature tool already available;
- treating "technically safe" or "well-tested" as sufficient even when the product still needs heavy owner intervention;
- spending large implementation effort on defensive behavior while the frontend, onboarding, workflow clarity, and end-to-end usability remain weak.

The resulting software may be technically sophisticated yet still fail productization because a normal user cannot complete the intended job without the creator rescuing them.

Working correction:

1. optimize first for the accepted primary user job;
2. reuse mature systems and their defaults;
3. add only the edge cases required by the current slice or demonstrated by real failures;
4. keep explicit security invariants that the owner requested;
5. do not let speculative security/privacy/hardening become new product scope;
6. judge completion by end-to-end usability and low human rescue, not defensive code volume.

This is not an instruction to ignore real security requirements. It is an instruction to keep security proportional to the accepted product contract and not let agents use hypothetical risk as an unlimited scope-expansion mechanism.


### 18. Eval-driven slice contract

Eval-driven delivery is now a repository-level working method, not only a discussion idea.

Canonical reusable template:
- `docs/productization/SLICE_CONTRACT.md`

The locked flow is:

owner intent → strong planning model drafts PDD/SDD/EVAL → independent critique → owner accepts/corrects → locked slice → implementation → declared evals → production smoke where applicable → done/fix

The slice contract separates:
- PDD: user job, scope, reuse, observable outcome
- SDD: data authority, capabilities, API/provider/client design, existing-code reuse/replacement
- EVAL/TDD: public deterministic tests, end-to-end user flow, targeted metamorphic properties, optional hidden holdout, production smoke

Implementing agents do not get to redefine success after seeing what they built.

The hidden holdout is optional and should test the same product claim under unseen scenario details, not obscure implementation trivia.

`AGENTS.md` now requires agents doing vertical-slice work to read the locked packet before implementation.

## Questions still open

- Which Hermes/custom-setup files are truly canonical and which are generated/cache?
- Which agent memories should sync immediately versus periodically?
- Should transcripts be fully retained, summarized, or tiered?
- What exact storage policy decides local/server DB vs R2 vs Google Drive?
- What constitutes a "workspace" across personal data, SaaS apps, and software projects?
- What should be queryable by agents without additional approval?
- Which actions require human-bound approval?
- How should proposal simulation/diffing work before approval?
- What is the retention/archival policy for proposals and operational history?
- How should DuckDB/Parquet analytics be exposed to a workspace without inventing another bespoke DB console?

## Relevant existing project boundary

PCM already states that the project repository owns its own state and that Git is the transport; it is not intended to become a hosted memory database. This is useful because the new persistent agent/personal-data requirement should complement that boundary rather than duplicate PCM.

---

Status: discussion in progress. Update this file as owner decisions become clearer.
