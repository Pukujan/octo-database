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
