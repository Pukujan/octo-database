# Octo Productization Slice Map (Draft)

This map translates the program in `PROJECT.md` and issue #74 into bounded user jobs. It is planning input for owner review; no slice is locked until the owner accepts or corrects its packet on the owning issue.

## Ordered slices

| Order | Slice | Main dependency | Robustness |
|---|---|---|---|
| 0 | Complete runtime/bootstrap prerequisites and make the online test deployment usable | Existing deployment; #75/#76 train work remains separately gated | Level 2 for durability claims |
| 1 | Discover the operations a caller can use in a selected workspace, then invoke an advertised operation | Existing auth, API and PostgreSQL | Level 2: live authority and deployed API |
| 2 | Complete the existing workspace file lifecycle: find, retrieve, archive, restore and share intended files | Slice 1; existing gallery, storage and jobs | Level 2: durable bytes and transitions |
| 3 | Complete the same workspace/file jobs through the TypeScript SDK, CLI and MCP adapter | Slice 1; stabilized operations from Slice 2 | Level 2: client/server equivalence |
| 4 | Select a frontend delivery approach through a bounded bakeoff | Stable API plus Slice 2 fixtures | Level 1: evaluated prototype |
| 5 | Deliver the selected workspace shell with overview, gallery, keys and operations | Slice 4 and useful flows from Slices 1–3 | Level 2: real browser jobs |
| 6 | Recover one owner-declared set of important user/agent files on a fresh machine | Slice 2; recovery UI from Slice 5 | Level 2: recovery is the product claim |
| 7 | Answer one accepted historical workspace question with Parquet and DuckDB | API foundation and issue #13 | Level 2: durable dataset and result metadata |
| 8 | Let an agent propose one supported change, then let a human authorize that exact proposal | Slices 1–5; one supported action | Level 2: durable proposal and execution state |
| 9 | Rebuild and query an optional graph projection for a graph-enabled workspace | Existing epistemic model and issue #12 | Level 2: reconstruction and freshness |

**Conditional retrieval correction:** If a slice exposes RAG/GraphRAG retrieval, first lock a bounded issue #10 repair packet for PDF ingest, provenance, and rebuildable embeddings. This does not block unrelated API, file, shell, recovery, or analytics jobs.

Existing pgvector/RAG behavior should be reused where relevant; a new vector implementation is not proposed. The current RAG path has concrete ingest/rebuild and source-link limitations. Any later client or graph slice that exposes retrieval depends on a bounded repair/verification packet grounded in issue #10. Graph is optional per workspace. Level 3 hardening has no blanket authorization; scale work remains conditional on demonstrated load or an owner request.

The runtime/bootstrap lane and platform topology research proceed in parallel with product slices. They do not imply an architecture migration. Current production is reachable, but Gravebuster SSH is not reachable from this workstation; a temporary online test URL proves only the exact local runtime it serves.

## Draft packet links

- First packet, pending owner lock: [Workspace capability discovery](slices/01-workspace-capability-discovery.md)
- Later slice outlines: [Productization draft packets](slices/draft-packets.md)

## Frontend bakeoff timing

Run after Slice 1 establishes the stable API contract and Slice 2 provides representative file/job fixtures, alongside client work. Until then, keep the current dashboard as a prototype and verify Slice 1's API through its existing screen without expanding that UI. Compare a direct Next.js + shadcn/ui baseline with a workflow using OpenPencil for design and Onlook for real-code editing. Dyad or a similar rapid builder can replace that workflow if it cannot run. Use the same tasks, API, data, content direction and design rules; limit each candidate to the same flows and one revision. Compare completed tasks, owner interventions, erroneous actions, keyboard access, visual consistency and maintenance effort. Owner taste can veto. Choose one production workflow; do not keep competing shells.

## Luna work-order template

```text
Owning issue and parent:
Accepted packet revision/link and owner acceptance:
Repository path; base commit; assigned branch/worktree:
One concrete user job:
In-scope change and explicit exclusions:
Canonical authority and API requests/responses:
Existing code/providers to reuse:
Allowed file ownership / coordination boundary:
Public eval commands and required end-to-end user flow:
Named property/holdout checks, or “none”:
Failure/recovery boundary:
Acceptance checklist:
Required return: changed behavior/files, actual checks/outcomes, remaining failures, commit/PR URL and exact head
Delivery: target main and arm auto-merge; production remains owner-merged
Escalate only for a contradictory packet, unavailable required provider, or missing product decision
```

## Current blockers

- No product packet has owner acceptance yet. Slice 1 is ready for critique and owner correction, not implementation.
- Current `GET /api/capabilities` filters by scope but does not account for workspace binding, live membership role, or provider configuration consistently; dependable client work depends on correcting that contract.
- Recovery needs one owner-selected set of important files and an authority classification before sync behavior can be implemented.
- Production PostgreSQL is a local named container volume; a repository backup/restore path is not present. External host backups have not been checked.
- PR #75's first gate run failed the dashboard vision assertion. On its latest rerun, vision and train-manifest validation passed but the pinned ACS hot-loader check failed because it still requires CGM 0.5.7 while the PR adopts certified CGM 0.5.12 ([run](https://github.com/Pukujan/octo-database/actions/runs/37067546338)). Issue #76 explicitly depends on upstream train work.
- Local test Compose previously failed to apply migrations on this host and did not persist local object bytes across API replacement. PR #78 addresses both; its CI is blocked by the same baseline/train dependency as main.

Each accepted slice ships with its own end-to-end flow and appropriate deployed smoke. A cross-slice journey can be recorded later as a summary, but is not a new gate for earlier completed slices.
