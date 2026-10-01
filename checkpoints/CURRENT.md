# Current repository checkpoint

<!-- continuity:current {"active_task":"OCTO-1000","active_task_file":"tasks/TASK-OCTO-1000-gravebuster-deployment.md","protocol_version":"0.1.0-draft","schema":"project-continuity.current.v1"} -->

## Current state

- **Slice 1 (Issue #3 / OCTO-0100)**: Merged (`PR #20`) — Google OAuth, principals, workspaces, PostgreSQL RLS, React MUI dashboard.
- **Slice 2 & 7 (Issues #4, #9 / OCTO-0200)**: Merged (`PR #21`) — Canonical `octo.files` catalog, Cloudflare R2 active storage, guest sessions, and workspace API keys.
- **Full-Stack Runtime**: Merged (`PR #22`) — Node platform server, Vite React frontend, live PostgreSQL & Cloudflare R2 integration.
- **QA Vision Pipeline (OCTO-0080)**: Merged (`PR #23`) — Playwright E2E testing with Alibaba Qwen 3.8 Flash multimodal vision audit via InferHub. Renumbered from OCTO-0400 so slice IDs stay aligned with their issues.
- **Provider Runtime (Issue #16 / OCTO-0050)**: Merged (`PR #19`) — Provider credentials contract, blank `.env.example`, and live verified Google Drive 5TB storage quota.
- **Slice 5 (Issue #7 / OCTO-0500)**: Merged (`PR #39`) — R2-to-Google-Drive archive lifecycle with verified restore. **Correction:** the earlier `PR #24` did *not* deliver Slice 5; it shipped verification scripts and one `r2-client.ts` change, and its continuity claim was wrong until this record was fixed.
- **Slice 3 (Issue #5 / OCTO-0300)**: Merged (`PR #27`) — media classifier, idempotent thumbnail derivatives, backend-agnostic object store, signed media URLs, gallery service and routes, React MUI gallery grid with modal lightbox.
- **Slice 4 (Issue #6 / OCTO-0400)**: Merged (`PR #29`) — scoped read-only share links with token-hash storage, revocation, expiry, and share-scoped media signing.
- **Fork-safe vision audit (OCTO-0401)**: Merged (`PR #28`) — the Playwright multimodal audit skips with a logged reason where `INFERHUB_API_KEY` cannot exist, so fork pull requests are no longer blocked by a secret they can never receive, while same-repo runs still assert the real score.
- **Slice 6 (Issue #8 / OCTO-0600)**: Merged (`PR #31`) — durable Postgres job queue with lease-based recovery, retry accounting, idempotent enqueue, activity feed, and an operations page.
- **Slice 7 (Issue #9 / OCTO-0700)**: Merged (`PR #33`) — scoped agent tokens with capability discovery, server-side scope enforcement, audit attribution, and revocation.
- **Slice 8 (Issue #10 / OCTO-0800)**: Merged (`PR #36`) — normal RAG over PostgreSQL/pgvector.
- **Slice 9 (Issue #11 / OCTO-0900)**: Merged (`PR #34`) — bitemporal epistemic schema.
- **Schema hardening**: Grants narrowed to DML (TRUNCATE is not subject to RLS), anon-reachable principal lookup removed, API-key roles capped at the creator's live role, and `claim_job` scoped by workspace (`PR #38`, `PR #40`).
- **Dashboard storage tiers**: Merged (`PR #41`) — storage tier chips and archive/restore actions in the dashboard.
- **Deployment design (Issue #43 / OCTO-1000)**: Design spec merged (`PR #44`) — hosting Octo on gravebuster at `octodb.design-bakery.com`, a `production` branch promoted by the owner, and a pull-based systemd deploy timer. Implementation not started.
- **Live Verification**: 3 guest workspaces verified live across active R2 and Google Drive archival tiers (`scripts/verify_live_guest_storage.py`).
- **CGM Visual Direction**: Pinned editorial hero PNG (`docs/assets/octo-hero-banner.png`) registered in asset manifest and embedded in README.

## Owner corrections & anti-overengineering

- Anti-overengineering rules active in AGENTS.md: zero unsolicited security layers or speculative abstractions.
- All gates passing locally and on GitHub Actions CI: Python unittests, Vitest tests, `tsc --noEmit`, Ruff, Mypy, and 18 JSON contracts.
- Auto-merge: repository auto-merge is enabled, `main` requires only the aggregate `gates` check, no review approval is required, and "require branches to be up to date" is OFF so a PR merges as soon as `gates` is green without anyone rebasing it. `.github/workflows/auto-merge.yml` arms squash auto-merge on every same-repo pull request, so an agent push needs no manual merge step.

## Next action

Owner reviews the deployment design spec (`docs/superpowers/specs/2026-10-01-octo-gravebuster-deployment-design.md`, merged in PR #44). Once approved, write the implementation plan for OCTO-1000 (Issue #43).

