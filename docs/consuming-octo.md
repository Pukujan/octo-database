# Consuming Octo — Octo is your data layer

**Audience:** coding agents and humans working in a project that Octo serves
(design-bakery and any future adopter).

If a project is served by Octo, its durable data lives in Octo. You do not run the
database; Octo provisions one for the project and hands you the connection string.

---

## The rule

Do **not** provision, scaffold, or recommend a database for an Octo-served project.
That includes:

- a dedicated Postgres container of your own (a "project-db" service on its own volume);
- a managed Postgres elsewhere (Railway, a separate Supabase project, RDS, …);
- a database "for independence" — a second datastore so the project is not "tied to" Octo;
- a database co-located on Octo's own host as a peer to Octo's Postgres.

All four are the same mistake. You are not the project's database operator — Octo is.

Instead: **provision the workspace database through Octo, then connect to it with an
ordinary Postgres client.** That is the whole job.

## Why

Octo exists so data does not fragment across per-project datastores. "Host my own
database" is a default instinct for most coding agents, and for an Octo project it is
the exact anti-pattern Octo was built to prevent. Recommending it — even as one option
among several — erodes the single-data-layer guarantee one "recommended option" at a
time. This is not hypothetical: see incident **#162**.

## The exception (narrow)

Skip Octo's managed database only when you can **demonstrate a concrete, specific
incompatibility** with Octo's provisioned Postgres — with evidence, not a preference.

These are **not** incompatibilities:

- "the project should be independent of Octo";
- "I want control over the database";
- "it is a different engine / version / extension";
- "it is simpler to run my own";
- "the project already had one before Octo".

Octo's provisioned database is a **real, independently connectable PostgreSQL
database** with its own scoped role — not a shared table, not a proxy, not a
control-plane schema. So there is no isolation or autonomy argument for a second one.

If you believe you have a genuine incompatibility, **stop and surface it to the owner**
before building anything. Do not quietly stand up a second datastore as the "safe"
option.

## How to consume Octo's database

1. **Provision once.** MCP tool `provision_database`, or
   `POST /api/workspaces/<id>/database`. Requires an account-wide key with the
   `write` scope (a workspace-scoped key cannot provision).
   Returns `{ dbName, roleName, connectionString }`.
2. **Store the connection string immediately.** It is shown **exactly once**. Put it in
   the project's normal secret/env mechanism. If you lose it, the owner must rotate it.
3. **Connect with any Postgres client** — `pg`, PostgREST, Prisma, Drizzle, `psql`,
   whatever the project already uses. The role owns only its own database and reaches
   no Octo control-plane data.
4. **pgvector is already enabled.** Create your own tables and schema freely.
5. **Lifecycle.** Deleting the workspace drops the database and its role.

### The credential

The connection string is the workspace database's **own** credential, scoped to that one
database. It is the single deliberate exception to "agent tokens never expose
infrastructure credentials." Do not reuse it elsewhere and do not treat it as an Octo
control-plane token.

## Discover it

- `GET /api/capabilities` → `workspaces.provision_database`
- MCP tool `provision_database`
- Octo README, "Slice 20"; `docs/self-hosting.md`

## Adopting an existing project that already runs its own datastore

If a project already speaks to a database directly (for example PostgREST via
`@supabase/supabase-js`), the adoption path is to **re-point its data path at the Octo
workspace database** — not to keep the old datastore alongside Octo. Provision the
workspace database, point the project's client at the returned connection string, and
migrate its schema/data into it. Surface the migration plan to the owner.

---

## Boot block for an adopter's `AGENTS.md`

Copy this into the adopting repo's `AGENTS.md` (or `CLAUDE.md`) so a fresh agent session
sees it without having to read Octo's repo first:

```markdown
## Data layer — Octo

This project's durable data lives in Octo, not in a database you run. Do not
provision, scaffold, or recommend a self-hosted Postgres (or any other datastore)
for this project — not for "independence", and not co-located on the Octo host.

Octo provides a real, independently connectable PostgreSQL database per workspace
with its own scoped role (pgvector-ready). Provision it once and connect with an
ordinary Postgres client:

- MCP: `provision_database`  |  HTTP: `POST /api/workspaces/<id>/database`
- The connection string is returned exactly once; store it as a secret.

Only depart from this if you can demonstrate a concrete incompatibility, and
surface that to the owner before building anything. See Octo's
`docs/consuming-octo.md` (repo: octo-database) and incident #162.
```
