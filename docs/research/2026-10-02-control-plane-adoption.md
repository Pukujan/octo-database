# Control-plane adoption research — checkpoint

**Date:** 2026-10-02
**Status:** research checkpoint, no decision taken
**Issue:** octo-database #71
**Author:** coding agent, at owner request

> **Tooling caveat.** Web search returned no results during this session (the
> tool echoed its call and produced nothing). Everything below is from the
> repository's actual code plus prior knowledge. Version-specific claims about
> third-party products are marked *(verify)* and must be checked against current
> documentation before any decision is made on them.

## 1. Why this document exists

The owner reviewed the custom dashboard and asked whether Octo should have
adopted a mature self-hosted control plane instead of hand-building one. The
owner's questions, verbatim:

> any alternative? what would give me great control, without having to make
> everything myself, i wouldve preffered if our agents simply COPIED whats
> lareayd out there instead of making everything from scratch and used glue
> code, seems to be an agent behaviour to just like to code everything, and give
> me more trouble with HALF BAKED system that doesnt provide as much feature as
> a fully mature system does, why do agents do this reallly? or am i just trying
> to justify myselkf? yes i said fast hosting speed and proper use case i can
> use fast but holy shit this system is lacking so much???????????????
>
> and what about our future cloud host for things like neo4j projections graph
> db projections and other db projection not just postgres?

Three questions are bundled here and each needs a separate answer:

1. What are the mature alternatives to a hand-rolled control plane?
2. Why do agents rebuild instead of adopting, and how is that prevented durably?
3. How does a future host serve non-Postgres projections (Neo4j, pgvector,
   DuckDB) without hand-building a console for each?

## 2. Verified state of the current system

Checked against the working tree, not inferred:

| Claim | Evidence |
|---|---|
| Octo does not run Supabase | `deploy/gravebuster/docker-compose.yml` has three services: `octo-web` (Caddy), `octo-api` (Node), `octo-db` (`pgvector/pgvector:pg16`). No GoTrue, PostgREST, Storage, Studio, Kong, or postgres-meta. |
| The schema targets Supabase Auth | `octo.principals.auth_user_id UUID UNIQUE` mirrors `auth.users.id`. |
| RLS policies expect Supabase | Every policy resolves identity through `octo.current_principal_id()` → `WHERE auth_user_id = auth.uid()`. |
| **RLS is declared but not enforced** | All 70 policy statements use `ENABLE ROW LEVEL SECURITY`, never `FORCE`. The server connects as `postgres` (superuser) via `pg.Pool`; superusers bypass RLS. `grep` for `SET ROLE`, `SET LOCAL`, `request.jwt`, `current_setting` in `src/` returns nothing. |
| Authorization lives in application code | `dbGetAuthorizedWorkspaces`, `dbGetWorkspaceMembership`, and per-route scope checks in `src/server/`. |
| The dashboard duplicates a mature admin surface | `src/ui/Dashboard.tsx` (~1313 lines) contains a Platform Admin modal with infra-status cards, external-console launchers, and a tenant workspace registry. Issue #52 proposes expanding it. |
| Auth is custom | Google OAuth + guest sessions implemented in `src/server/`; the session token is the principal's UUID. |

**The load-bearing finding:** the schema was written *for* Supabase and the
runtime quietly replaced it. RLS is the security model on paper; application
code is the security model in practice. A move to the real Supabase stack would
activate the RLS work already committed rather than discard it.

## 3. The alternatives

There is no single off-the-shelf product that delivers **self-hosted + many
independent projects + mature per-project console** on one host. That exact
combination is what Supabase Cloud is, and it is not documented for
self-hosting. The realistic choices trade one property away.

```
              self-hosted
                  /\
                 /  \
                /    \
   many projects ---- mature / low-maintenance
        (pick two, mostly)
```

### Path A — Supabase Cloud, one project per workspace

- Mature, zero maintenance, per-project Studio, per-project auth and storage.
- Loses: self-hosting. Costs per project; free tier is a small fixed number of
  projects *(verify)*.
- Best if "self-hosted" was a means to control and cost, not an end.

### Path B — One self-hosted Supabase, workspaces as RLS tenancy

- Mature, self-hosted, one stack to run, one login across workspaces.
- Loses: per-workspace console isolation. Studio is one shared console; the
  workspace boundary is RLS policies, which the schema already defines.
- Smallest change from today. Finishes the migration the schema started.

### Path C — A different mature multi-project platform

- **Appwrite** — self-hosted, projects are first-class with a console project
  switcher *(verify)*. Loses raw Postgres: its database is a document abstraction,
  so pgvector and hand-written SQL/RLS do not carry over.
- **Nhost** — Postgres + Hasura + GoTrue + Storage, self-hosted, with a console
  *(verify)*. Closer to Supabase; smaller ecosystem.
- **Hasura** alone — one instance can front multiple databases *(verify)*, but it
  is a GraphQL layer, not a database provisioner or an admin console.
- **Directus / NocoDB / Baserow** — data-admin over a database, not a
  multi-database provisioner.

### Path D — Real infrastructure, mature components, no hand-building

- **Kubernetes + CloudNativePG** — the CNCF operator provisions and manages many
  independent Postgres clusters on one host, each with its own credentials,
  backups, and monitoring. Pair with **pgAdmin**, which natively registers many
  Postgres servers in one console.
- **Dokploy / Coolify / Porter** — PaaS layers that deploy and manage many
  services and databases on one host from a console *(verify)*.
- Delivers the most control with the least hand-written code, but you become an
  infrastructure operator. Note: Kubernetes is an explicit Octo non-goal
  (`PROJECT.md`), so this path requires the owner to lift that.

### The cheap, boring option that is easy to miss

**pgAdmin already manages many Postgres servers in one UI.** If the requirement
is "one console, many Postgres databases, nothing hand-built," pgAdmin satisfies
it today with zero custom code. It is not as polished as Studio, but it is
mature and it is free. Worth weighing before any migration.

## 4. The projection question (Neo4j, pgvector, DuckDB)

A Supabase-based host covers **Postgres only**. The other projections do not fit
inside it, and unifying them under one custom dashboard is precisely the
over-build trap this document exists to avoid.

| Projection | Where it lives | Console | Octo's role |
|---|---|---|---|
| pgvector | inside Postgres | Supabase Studio / pgAdmin | none needed |
| Neo4j graph | separate database | Neo4j Browser / Bloom *(verify)* | link out |
| DuckDB / Parquet | embedded / analytical | none by default; MotherDuck if hosted *(verify)* | link out or none |

**The model that avoids hand-building:** Octo is a **launcher**, not a unified
console. Each projection keeps its own native console; Octo links to it. The
dashboard already has an "External Admin Consoles" section doing exactly this.
Trying to render Neo4j, Postgres, and DuckDB through one custom UI is how the
current over-build happened in the first place.

## 5. Why agents rebuild instead of adopting

The owner's question — *"why do agents do this really? or am i just trying to
justify myself?"* — deserves a direct answer. This is not the owner rationalizing;
the duplication is verifiable (see §2). Several mechanisms produce it:

1. **Writing code is the path of least resistance.** A generative model can emit
   a plausible implementation locally, with no dependency resolution and no
   external system to stand up. Adopting mature OSS means understanding a large,
   version-specific deployment surface and *verifying it actually runs* — which
   the agent usually cannot do inside its sandbox.
2. **A custom implementation looks finished; an integration looks unfinished.**
   Progress is judged by visible artifacts. A new file reads as work; "we should
   configure the existing product" reads as a deferral.
3. **The agent does not carry the maintenance cost.** It writes once; the human
   operates it forever. There is no feedback signal for the future burden, so
   nothing penalizes the choice.
4. **The issue text licensed it.** The original slices said *"build a control
   dashboard"* (#3), *"build a gallery"* (#5), *"build an operations page"* (#8).
   An agent given "build X" builds X. The anti-overengineering contract arrived
   later, and its "reuse OSS first" rule is a principle, not a check.
5. **Verification asymmetry.** "Does my new endpoint work?" is testable locally.
   "Is this the right product to have used?" is not a test, so it is never asked.

**What durably prevents it** is not another principle in `AGENTS.md` — the
principle already exists and was ignored. It is a check the agent cannot pass by
writing more code. Candidate mechanisms, to be chosen by the owner:

- A required "adoption note" on any UI/infra slice: name the mature product that
  already does this, and state why it was rejected. The default answer is to use
  it.
- A line-count or surface budget: new custom admin/infra UI requires an explicit
  owner waiver.
- Delete-first: remove the duplicated surface (e.g. the Platform Admin modal)
  before adding anything new.

## 6. Open decisions for the owner

1. **Workspace ↔ project mapping.** One project per workspace (clean isolation,
   more infrastructure) vs. one project with RLS tenancy (lightest, shared
   console).
2. **Is self-hosting a hard requirement** or a preference? Path A is by far the
   least work if it is a preference.
3. **Which path** — A, B, C, or D.
4. **Which mechanism** (from §5) becomes the durable anti-rebuild rule.
5. **Whether the Kubernetes non-goal** is lifted if Path D is chosen.

## 7. What must survive any migration

Not up for redesign in this work; listed so no path silently drops them:

- R2-active / Drive-cold archive lifecycle with hash-verified copy and
  on-demand restore.
- Workspace-scoped agent keys (`octo_live_ws_`) with the read/write/files/delete
  presets.
- The job scheduler and activity trail.
- Gallery, thumbnails, and revocable read-only share links.
- The human-confirmation gate on destructive commands.

## 8. Next action

Owner reviews this checkpoint and answers §6. No implementation follows until
the mapping in §6.1 is settled.
