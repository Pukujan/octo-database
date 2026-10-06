# Working notes — MCP, docs site, and owner observability (2026-10-04)

Status: notes only. This file records what exists, what does not, and the open
owner questions. It creates no scope, no gates, and no acceptance criteria; the
owner decides what, if anything, is built from it.

## Why this file

The owner asked three things and hit a fourth, and the session was restarted
mid-discussion. This captures the verified state so the next session starts from
facts instead of re-deriving them.

## Verified current state

### MCP — exists, minimal

- Entry point: `npm run mcp` → `scripts/octo-mcp.ts` (stdio transport).
- Implementation: `src/mcp/server.ts` (tools), `src/mcp/client.ts` (HTTP client).
- Token: `OCTO_MCP_TOKEN` (an Octo API key); base URL `OCTO_MCP_BASE_URL`
  (default `http://localhost:3001`).
- Exposed tools, exactly five:
  `whoami`, `list_workspaces`, `list_files`, `upload_file`, `query_workspace`.
- Not exposed: create/delete workspace, delete file, archive, restore, jobs
  list/enqueue/run, gallery, activity, file download, key revoke.
- The adapter adds no policy; it forwards to the public API and reports the
  API's decision (`src/mcp/server.ts:1-10`).

### Docs — no website

- No site generator in the repo (no VitePress/Docusaurus/Starlight/MkDocs/Astro).
- Documentation is markdown only: `README.md`, `docs/**`, `HANDOFF.md`,
  `PROJECT.md`, `AGENTS.md`, `planning/**`, `tasks/**`.
- The server serves only the built app: `dist/` assets and `index.html`
  (`src/server/index.ts:2606,2613`). There is no docs route or docs URL.
- Deploy target is three containers behind Caddy on gravebuster
  (`docs/self-hosting.md`): `octo-web` (static `dist/` + proxy), `octo-api`,
  `octo-db`. A static docs site could be served by the same `octo-web` Caddy.

### Non-admin workspace view — does not exist

- `dbGetAuthorizedWorkspaces` (`src/server/db.ts:184-229`): a platform owner
  gets **every workspace on the platform**, `role='owner'`, no membership join
  (`db.ts:199-213`). Every other principal is filtered to their own memberships
  (`db.ts:214-228`).
- There is no "mine only" filter, toggle, or route. The owner sees guest
  sandboxes alongside their own workspaces — this is the UX the owner hit.
- Production currently has 5 workspaces visible to the owner account: `Personal`
  (theirs), three empty `Personal (Guest)` sandboxes (one per guest login), and
  `Backup Verification (Drive)` (left by a prior session's live test).

### "Hand a workspace key to an agent → a live Postgres" — NOT built

- "Workspace = database" (`docs/PDD.md:31`) is a **logical** boundary. One
  workspace = one logical database, mapping to a row in `octo.workspaces`; there
  is no separate database entity.
- A workspace holds: file metadata (`octo.files`), bytes in R2, jobs/activity,
  and a RAG index (`octo.documents`/`document_versions`/`chunks`/`embeddings` on
  pgvector, `supabase/migrations/20261001050000_slice8_rag_pgvector.sql`).
- The API surface is files/jobs/gallery/activity/RAG (`src/api/capabilities.ts`).
  **No route provisions a Postgres database or returns a SQL connection string.**
  `query_workspace` / `POST /api/rag/query` is retrieval over indexed documents,
  not arbitrary SQL.
- This is consistent with the stated non-goal: "Per-database sub-entities inside
  a workspace" (`docs/PDD.md:142`), and it is the open owner decision in
  `docs/research/2026-10-02-control-plane-adoption.md`: *should one Octo
  workspace ever require its own independently provisioned database project?*
  That decision is unresolved. No migration should be inferred from that note.

## The reframing the owner gave

The owner's real goal is not "browse fewer workspaces." It is: **systematically
check and debug other people's operational problems.** So the owner-visible
workspace list is not clutter to hide — it is the entry point to an operator
surface. The filter question and the debug question are the same question.

The owner also stated the intent behind keys-to-agents: they want agents to be
able to stand up a real database for future projects. Today that is not possible
through Octo; only the logical workspace boundary exists.

## Owner answers so far

Recorded from the owner's selections; treat as owner direction, not agent
inference.

1. **Provisioned database per workspace — owner wants a REAL provisioned
   Postgres** per workspace/project, not the logical boundary. This is new
   capability and needs its own slice and its own spec before any code.
2. **Docs website — owner wants a static docs site in the repo** (generator
   under `docs/`, built to static files, deployable alongside the app).

## Open questions (owner to answer — do not assume)

1. **Owner observability surface.** When the owner opens another principal's
   workspace to debug:
   - read-only diagnosis (files, jobs, activity, errors), or
   - diagnosis **and** intervention (retry a stuck job, restore a file, reset a
     wedged archive), or
   - a platform-wide health list (failing jobs, stuck state) to spot problems
     proactively, then drill in?
   - And which comes first: jobs/background failures, or files/storage state?

## Candidate decomposition (for discussion, not approved)

| Piece | Shape | Notes |
|---|---|---|
| Non-admin workspace filter | small, bounded | Default-hide others with a toggle, or a "Mine / All" control |
| Owner debug/observability view | medium | Read-only vs. intervention is the fork |
| Docs website | new subsystem | Generator + static deploy; independent of the rest |
| MCP tool expansion | small–medium | Add tools mirroring existing API routes (create/delete/archive/restore/jobs/gallery) |
| Provisioned DB per workspace | new capability | Not built; needs owner decision and its own slice |

## Constraints in force

- `AGENTS.md`: owner drives; no unsolicited guardrails; minimum sufficient
  change; ask before adding scope, not before executing it.
- Standing owner constraint from the prior session: do not touch production data
  or credentials.
