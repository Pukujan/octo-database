# OCTO-1000 Host Octo on gravebuster with a production branch and gated CI/CD

<!-- continuity:task {"acceptance":["octodb.design-bakery.com serves the Octo UI over HTTPS","Google sign-in completes and lands on an authenticated dashboard","guest login still works","a merge to main does not deploy; a merge to production deploys within 5 minutes","a failing smoke test rolls back to the previous image automatically","gates runs on pull requests into both main and production","no secret is committed to the repository"],"depends_on":["OCTO-0100"],"goal":"Host Octo's frontend and backend as containers on gravebuster with a gated promotion path to production","id":"OCTO-1000","issue_url":"https://github.com/Pukujan/octo-database/issues/43","next_action":"Create pull request with auto-merge for OCTO-1000.","owner":"Pukujan; main agent coordinates implementation","priority":"P1","protocol_version":"0.1.0-draft","schema":"project-continuity.task.v1","status":"active","why":"Octo has no hosted instance and no delivery path from a merged commit to a running service."} -->

- Status: active
- Priority: P1
- Branch: `task/OCTO-1000-gravebuster-hosting`
- GitHub issue: https://github.com/Pukujan/octo-database/issues/43
- Design spec: `docs/superpowers/specs/2026-10-01-octo-gravebuster-deployment-design.md`

## Goal

Host Octo on gravebuster at `octodb.design-bakery.com`, with a CI/CD path that
cannot break the running service and a `production` branch the owner promotes to.

## Blocking defects this work must fix

1. `src/server/index.ts:465` sends users to Google with a callback redirect URI,
   but no `/api/auth/google/callback` route exists — Google sign-in is broken.
2. `src/server/index.ts` is API-only; nothing serves the Vite `dist/` build.
3. `url.origin` (line 436) derives from a hardcoded `http://localhost:${PORT}`
   base, so the redirect URI is wrong behind the tunnel.
4. The server reads `GOOGLE_OAUTH_CLIENT_ID`/`_SECRET`; the repo `.env` defines
   `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`.

## Owner-confirmed decisions

Dedicated Postgres container; keep `main`, add `production`; promotion via a PR
from `main` merged by the owner; pull-based systemd deploy timer; secrets copied
to gravebuster over SSH; Podman for the WSL test stack; reuse the existing Google
client and implement the missing callback.

## Owner actions required

- Add `https://octodb.design-bakery.com/api/auth/google/callback` as an authorized
  redirect URI on the existing Google OAuth client.
- Add the tunnel hostname in the Zero Trust dashboard; the repo's Cloudflare
  tokens both fail `/user/tokens/verify` with error code 1000.
- Confirm port 8090 is free on gravebuster.

## Not in scope

Schema-migration tooling for a live database, scale-out (Issue #14), rotating the
expired Cloudflare tokens.

## Checkpoint log

### 2026-10-01 08:00:00 UTC — Pukujan

<!-- continuity:checkpoint {"agent":"Pukujan","blocked":[],"changed":["docs/superpowers/specs/2026-10-01-octo-gravebuster-deployment-design.md"],"completed":["Design spec for hosting Octo on gravebuster with gated CI/CD"],"decisions":["Dedicated Postgres container on gravebuster","Keep main, add production branch promoted by owner PR","Pull-based systemd deploy timer polling origin/production"],"evidence":["PR #44 merged with green gates"],"next_action":"Owner reviews deployment design spec and begins implementation","protocol_version":"0.1.0-draft","schema":"project-continuity.checkpoint.v1","task_id":"OCTO-1000","timestamp":"2026-10-01T08:00:00Z"} -->

Completed:
- Design spec for hosting Octo on gravebuster with gated CI/CD

Evidence:
- PR #44 merged with green gates

Decisions:
- Dedicated Postgres container on gravebuster
- Keep main, add production branch promoted by owner PR
- Pull-based systemd deploy timer polling origin/production

Changed:
- docs/superpowers/specs/2026-10-01-octo-gravebuster-deployment-design.md

Blocked/uncertain:
- none

Next:
- Owner reviews deployment design spec and begins implementation

### 2026-10-01 19:40:00 UTC — Pukujan

<!-- continuity:checkpoint {"agent":"Pukujan","blocked":[],"changed":["AGENTS.md",".github/workflows/gates.yml","deploy/gravebuster/","deploy/local/","docs/self-hosting.md","src/main.tsx","src/server/db.ts","src/server/index.ts","tests/unit/oauth-and-origin.test.ts"],"completed":["Implemented Google OAuth callback, /api/me endpoint, frontend fragment pickup, public origin resolution, static file serving, and gravebuster Docker Compose stack"],"decisions":["Use deterministic UUID derived from Google sub to satisfy Postgres UUID auth_user_id","Serve Vite dist as static fallback in Node server and via Caddy in gravebuster compose","Support both GOOGLE_OAUTH_CLIENT_ID and GOOGLE_CLIENT_ID seamlessly"],"evidence":["112 Vitest tests pass across 20 files","tsc --noEmit passes","JSON contract integrity passes (18 contracts)","55 python unit tests pass","PCM validate and CGM validate pass"],"next_action":"Create pull request with auto-merge for OCTO-1000","protocol_version":"0.1.0-draft","schema":"project-continuity.checkpoint.v1","task_id":"OCTO-1000","timestamp":"2026-10-01T19:40:00Z"} -->

Completed:
- Implemented Google OAuth callback, /api/me endpoint, frontend fragment pickup, public origin resolution, static file serving, and gravebuster Docker Compose stack

Evidence:
- 112 Vitest tests pass across 20 files
- tsc --noEmit passes
- JSON contract integrity passes (18 contracts)
- 55 python unit tests pass
- PCM validate and CGM validate pass

Decisions:
- Use deterministic UUID derived from Google sub to satisfy Postgres UUID auth_user_id
- Serve Vite dist as static fallback in Node server and via Caddy in gravebuster compose
- Support both GOOGLE_OAUTH_CLIENT_ID and GOOGLE_CLIENT_ID seamlessly

Changed:
- AGENTS.md
- .github/workflows/gates.yml
- deploy/gravebuster/
- deploy/local/
- docs/self-hosting.md
- src/main.tsx
- src/server/db.ts
- src/server/index.ts
- tests/unit/oauth-and-origin.test.ts

Blocked/uncertain:
- none

Next:
- Create pull request with auto-merge for OCTO-1000


