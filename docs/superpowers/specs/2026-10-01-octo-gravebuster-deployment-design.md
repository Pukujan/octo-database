# Octo on gravebuster — deployment, CI/CD, and production branch

**Status:** Draft for owner review
**Date:** 2026-10-01
**Task:** OCTO-1000-gravebuster-deployment
**Issue:** #43
**Related:** Issue #1 (control plane), `.github/workflows/gates.yml`, `deploy/gravebuster/*` in `design-bakery`

## 1. Problem

Octo runs only on a developer machine. There is no hosted instance, no way to reach
it from outside `localhost`, and no delivery path from a merged commit to a running
service. Two concrete defects block any hosted deployment today:

1. **Google sign-in is broken, not merely unconfigured.** `src/server/index.ts:465`
   sends the user to Google with `redirect_uri=${url.origin}/api/auth/google/callback`,
   but no route handles that callback. The complete route list contains
   `/api/auth/google` and `/api/auth/guest` and nothing else. A user who clicks
   "Sign in with Google" is redirected to Google and then back to a 404.
2. **The server serves no frontend.** `src/server/index.ts` is API-only (`/api/*`,
   `/health`). Vite builds `dist/`, but nothing serves it.

Two secondary defects surface as soon as the service is proxied:

3. **The OAuth redirect URI is computed from the wrong origin.** `url.origin`
   derives from the hardcoded base `http://localhost:${PORT}` (`index.ts:436`).
   Nothing reads `X-Forwarded-Host` or `X-Forwarded-Proto`, so behind the tunnel
   the redirect URI would be `http://localhost:3001/...` and Google would reject it.
4. **The env var names do not match.** The server reads `GOOGLE_OAUTH_CLIENT_ID`
   and `GOOGLE_OAUTH_CLIENT_SECRET`; the repo `.env` defines `GOOGLE_CLIENT_ID`
   and `GOOGLE_CLIENT_SECRET`. A hosted container given the `.env` verbatim would
   report `googleAuthEnabled: false`.

The goal is a hosted Octo at `octodb.design-bakery.com` on gravebuster, with a
CI/CD path that cannot break the running service, and a production branch that only
the owner promotes to.

## 2. Decisions taken (owner-confirmed)

| Question | Decision |
| --- | --- |
| Production database | Dedicated Postgres container on gravebuster |
| Branch model | Keep `main`; add a `production` branch |
| Promotion mechanism | PR from `main` into `production`, merged by the owner |
| Deploy trigger | Pull-based systemd timer polling `origin/production` every 5 min |
| Secrets | Owner copies the local `.env` to gravebuster over SSH |
| Test environment | Podman in WSL on the dev machine |
| Google sign-in | Reuse the existing `GOOGLE_CLIENT_ID`; implement the missing callback as part of this work |
| Hostname | `octodb.design-bakery.com` |

## 3. Architecture

### 3.1 Containers on gravebuster

A new compose project `octo`, alongside the existing `design-bakery` project, in a
separate checkout at `~/apps/octo`. Nothing here touches the study-os stack.

```
                      Cloudflare Tunnel (study-os-cloudflared-1)
                                      │  study-os_edge
                                      ▼
                          ┌───────────────────────┐
   octodb.design-bakery ─▶│  octo-web  (Caddy 2)  │  127.0.0.1:8090
   .com                   │  static dist + proxy  │
                          └───────────┬───────────┘
                                      │ /api/*, /health
                                      ▼
                          ┌───────────────────────┐
                          │  octo-api (Node 22)   │  internal only
                          │  tsx src/server/...   │
                          └───────────┬───────────┘
                                      │ postgres://
                                      ▼
                          ┌───────────────────────┐
                          │  octo-db              │  internal only
                          │  pgvector/pgvector:16 │  volume: octo-db-data
                          └───────────────────────┘
```

**`octo-web`** — `caddy:2-alpine`. Serves the Vite build from `/srv` and reverse
proxies `/api/*` and `/health` to `octo-api:3001`. This keeps the browser on one
origin, so no CORS handling and no API base URL are needed in the frontend
(`src/main.tsx:19` already uses `const API_BASE = ''`). Published on
`127.0.0.1:8090` only — 8085 is taken by design-bakery. Port 8090 is a choice to
confirm on the box before first deploy (`ss -ltn | grep ':8090 '`).

The Caddyfile is short: a `/healthz` liveness responder for the container
healthcheck, `handle /api/*` and `handle /health` → `reverse_proxy octo-api:3001`,
and `file_server` with a `try_files {path} /index.html` SPA fallback for
everything else. The app is a single `App` component with no client router, so the
fallback matters mainly for deep links back into `/` after the OAuth redirect.

A single ingress target also means one Cloudflare hostname mapping: the tunnel
points `octodb.design-bakery.com` at `octo-web`, and Caddy splits static from API.

**`octo-api`** — `node:22-bookworm-slim` running `tsx src/server/index.ts`. No
build step: the repo runs TypeScript directly through `tsx`, and the server has no
compile step in `package.json`. `sharp` needs the platform-native binary, so the
image installs from the repo's lockfile on `linux/amd64` rather than copying
`node_modules` from Windows.

**`octo-db`** — `pgvector/pgvector:pg16` (the same image the CI gate uses), with a
named volume `octo-db-data`. Two read-only mounts into
`/docker-entrypoint-initdb.d`: the checked-in `00-supabase-auth-scaffold.sql`, and
the repo's `supabase/migrations/` directory. The Postgres entrypoint runs that
directory's files once, in lexical order, when it initializes an empty data
directory. `00-…` sorts before `2026…`, so the scaffold is created before the
migrations — the same ordering `gates.yml` performs by hand, with no wrapper
script and no hand-maintained file list.

Every migration is idempotent by construction (`CREATE TABLE IF NOT EXISTS`,
`CREATE OR REPLACE FUNCTION`, `CREATE INDEX IF NOT EXISTS`, `CREATE SCHEMA IF NOT
EXISTS`, `CREATE EXTENSION IF NOT EXISTS`), so a re-run is harmless. `CREATE
POLICY` is the one statement that is not, which is why this path only ever runs
against a fresh volume. Schema evolution against a populated database is a
separate concern and is out of scope here (§7).

### 3.2 The Supabase auth scaffolding

The migrations depend on Supabase-provided objects that a stock Postgres image does
not have: `auth.uid()`, `auth.role()`, and the `anon` / `authenticated` roles
(`20261001000000_slice1_...sql:55,156-162`). CI creates these with inline SQL in
`gates.yml`. The production database needs the same scaffolding.

Octo does not use Supabase Auth at runtime. The server connects to Postgres
directly with the connection string in `DATABASE_URL`, and authorization is
performed in application code (`src/server/index.ts` checks `mem.role` on every
mutating route; a grep for `set_config`, `SET LOCAL`, and `request.jwt` finds
nothing). Because that connection is the database superuser, the RLS policies are
bypassed at runtime and act as a schema-level backstop rather than the live
authorization gate. The `auth.*` objects are therefore needed only so the
migrations can be applied at all, and they are reproduced verbatim from
`gates.yml` into a checked-in `deploy/gravebuster/initdb/00-supabase-auth-scaffold.sql`
so the two cannot drift.

### 3.3 Repository layout

```
deploy/gravebuster/
  Dockerfile.web            # multi-stage: node build → caddy:2-alpine
  Dockerfile.api            # node:22-bookworm-slim + tsx
  Caddyfile                 # static + /api,/health reverse proxy
  docker-compose.yml        # octo-web, octo-api, octo-db
  docker-compose.edge.yml   # joins study-os_edge with alias octo-web
  initdb/
    00-supabase-auth-scaffold.sql   # mounted ahead of the repo migrations
  deploy.sh                 # build → swap → health → smoke → auto-rollback
  rollback.sh
  autodeploy.sh             # polls origin/production
  systemd/octo-autodeploy.{service,timer}
  .env.example
  .dockerignore
docs/self-hosting.md        # runbook, adapted from design-bakery's
```

These are adapted from the proven `design-bakery` stack rather than invented:
same state-file contract (`.deploy-state` holding `SHA` / `CURRENT_IMAGE` /
`PREVIOUS_IMAGE` / `DEPLOYED_AT`), same `wait_healthy` + `smoke` + auto-rollback
structure, same systemd unit shape (`Nice=10`, `CPUSchedulingPolicy=batch`,
`TimeoutStartSec=1800`), same `OnCalendar=*:0/5` timer with `RandomizedDelaySec=90`.

### 3.4 Application changes

Four changes in `src/`, all strictly required for the hosted workflow:

**a. OAuth callback.** Add `GET /api/auth/google/callback`:
- Exchange `code` for tokens at `https://oauth2.googleapis.com/token`.
- Read the verified `email` and `sub` from the ID token.
- Upsert an `octo.principals` row keyed on `auth_user_id = sub` (the column and
  index already exist from Slice 1), setting `is_guest = false`.
- Redirect to `/#token=<principalId>` — the fragment, not the query string, so the
  session token never reaches a server log, a `Referer` header, or the tunnel's
  request history.
- On any failure, redirect to `/#auth_error=<code>` rather than returning JSON, so
  the browser lands somewhere usable.

**b. Current-principal endpoint.** Add `GET /api/me`, returning the principal
resolved by the existing `authenticateRequest` helper (or 401). Guest login
returns the principal object alongside the token, so the frontend has it in hand;
an OAuth callback can only hand back a token, so the frontend needs a way to
resolve it. This is the minimum addition that makes the two login paths
symmetric.

**c. Frontend token pickup.** `src/main.tsx` reads `octo_token` from
`localStorage` on mount (line 27). Add: if the URL fragment carries `token=`,
store it as `octo_token`, call `GET /api/me` to load the principal into
`octo_principal`, and clear the fragment with `history.replaceState`. This reuses
the existing session model — the token remains the principal id sent as
`Authorization: Bearer`, which `authenticateRequest` already accepts (`index.ts`,
"Direct session / principal ID token").

**d. Correct origin for the redirect URI.** Add `PUBLIC_BASE_URL` to the server
config. `redirectUri = ${PUBLIC_BASE_URL}/api/auth/google/callback` when set;
otherwise fall back to `X-Forwarded-Proto` + `X-Forwarded-Host` when present, then
to `url.origin`. Set `PUBLIC_BASE_URL=https://octodb.design-bakery.com` in the
deployed `.env`.

The env-name mismatch is resolved in `deploy/gravebuster/.env.example` by
documenting `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` as the names the
server reads, with the owner's `.env` mapped accordingly at copy time. No change
to the server's variable names.

## 4. Branch model and CI/CD

### 4.1 Branches

- **`main`** — unchanged. Every agent PR targets it, `auto-merge.yml` arms squash
  auto-merge on same-repo PRs, and `main` requires only the aggregate `gates`
  check. No review requirement, no manual rebase.
- **`production`** — new, long-lived, created from `main`. It is the deploy source
  of truth. It advances **only** by a PR from `main` merged by the owner.

`auto-merge.yml` triggers on `pull_request: branches: [main]`, so it does not arm
on PRs into `production`. That is the desired behavior and requires no change.

### 4.2 CI changes

`gates.yml` currently triggers on `pull_request` / `push` to `main`. Extend both
to include `production`:

```yaml
on:
  pull_request:
    branches: [main, production]
  push:
    branches: [main, production]
```

This means a PR from `main` into `production` is validated by the same `gates`
check before the owner merges it, and the resulting push to `production` is
validated again. No new workflow, no new required check, no deploy credential in
GitHub Actions.

### 4.3 Deploy flow

```
agent PR ──▶ main (auto-merge on green gates)
                │
                │  owner opens PR main ──▶ production, reviews, merges
                ▼
           production
                │  systemd timer polls origin/production every 5 min
                ▼
        autodeploy.sh ──▶ deploy.sh ──▶ build SHA-tagged image
                                     ──▶ swap container
                                     ──▶ health check (90s)
                                     ──▶ smoke test
                                     ──▶ on failure: auto-rollback
```

The deploy is pull-based because gravebuster is not publicly reachable, so GitHub
cannot deliver a webhook. This is the same constraint and the same solution as
design-bakery.

**Smoke test** for Octo: `GET /health` returns 200 with `status: ok` and a
connected database; `GET /` returns 200 (the SPA shell); a static asset returns
200; `GET /api/workspaces` without a token returns 401. These prove the web tier,
the proxy hop, the API, and the database are all live.

### 4.4 AGENTS.md carve-out

`AGENTS.md` currently states: "Auto-merge is mandatory... Every agent MUST arm
auto-merge on every pull request it opens." That rule would deadlock against an
owner-gated `production` branch. The file needs one scoped amendment:

> Auto-merge applies to pull requests targeting `main`. Pull requests targeting
> `production` are owner-merged by standing instruction and must not be armed for
> auto-merge.

## 5. Test environment (WSL + Podman)

The owner's choice is Podman rather than Docker for the local test stack. WSL
Ubuntu 24.04 currently has the Docker CLI (29.5.3) but no daemon socket; Podman
4.9.3 installs from the distribution's apt archive and runs rootless, which suits
a local throwaway stack.

`deploy/local/docker-compose.yml` (a Podman-compatible compose file) brings up the
same three services against a throwaway volume and a local-only port, so the
container topology can be exercised without touching gravebuster. `podman-compose
up` runs it; the migrations and the Supabase scaffolding apply the same way as in
production. This environment is for validating image builds and the compose wiring,
not for CI — `gates.yml` stays on GitHub-hosted runners.

## 6. Owner actions

These cannot be performed by an agent and are prerequisites for the hosted
instance:

1. **Add the OAuth redirect URI** in the Google Cloud Console for the existing
   client: `https://octodb.design-bakery.com/api/auth/google/callback`. Without
   this, Google returns `redirect_uri_mismatch` and sign-in cannot work.
2. **Add the tunnel hostname.** The repo's `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ZONE_API_TOKEN` both return `Invalid API Token` (code 1000) from
   `/client/v4/user/tokens/verify`, so the ingress cannot be added by API. Add
   `octodb.design-bakery.com` → `http://octo-web:80` in the Zero Trust dashboard
   instead, or supply a working token and the step can be scripted.
3. **Copy the `.env` to gravebuster** at `~/apps/octo/deploy/gravebuster/.env`,
   with the name mapping from §3.4 and these additions:
   - `DATABASE_URL=postgresql://postgres:<generated>@octo-db:5432/octo`
   - `PUBLIC_BASE_URL=https://octodb.design-bakery.com`
   - `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` (from the existing
     `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`)
   - `OCTO_MEDIA_SECRET` (a fresh random value)
   - `OCTO_STORAGE_BACKEND` left at its production default (R2)
4. **Confirm port 8090 is free** on gravebuster.

The database user must be the `postgres` superuser. The server never sets a
session JWT claim, so the RLS policies would evaluate `auth.uid()` as NULL for a
limited role and hide every row. This matches both local dev and CI, which connect
as `postgres` for the same reason.

The `.env` file is git-ignored and must never be committed. No secret is written
into the image, the compose file, or GitHub Actions.

## 7. Out of scope

- Schema migration tooling for a live database (migrations run on first boot only).
- Multiple API nodes, workers, or scale-out (that is Issue #14).
- Replacing Supabase as a hosted dependency — the migrations' auth scaffolding is
  reproduced locally, but the Supabase project itself is untouched.
- Any change to the R2 or Google Drive archival path.
- Rotating or repairing the expired Cloudflare tokens.

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| Migrations are not tracked, so a future non-idempotent migration would be skipped on an existing volume | Entrypoint applies migrations only on a fresh volume and logs that it did; live-schema evolution is explicitly deferred (§3.1) |
| The Supabase scaffolding drifts from `gates.yml` | It is a checked-in copy of the same SQL, applied identically in both places |
| The production database has no backup | Named volume on gravebuster; backup strategy is a separate task and is not invented here |
| A bad deploy reaches `production` | Owner-gated promotion, `gates` on the PR, health check, smoke test, and auto-rollback to the previous image |
| OAuth fragment token visible in browser history | Fragment is not sent to servers; the token is a principal id that is revocable, and the instance is single-owner |

## 9. Acceptance

- `octodb.design-bakery.com` serves the Octo UI over HTTPS.
- "Sign in with Google" completes and lands on an authenticated dashboard.
- Guest login still works.
- A merge to `main` does not deploy; a merge to `production` deploys within 5
  minutes.
- A failing smoke test rolls back to the previous image automatically.
- `gates` runs on PRs into both `main` and `production`.
- No secret is committed to the repository.
