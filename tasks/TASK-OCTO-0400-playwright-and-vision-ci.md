# OCTO-0400 Playwright E2E and Multimodal Vision Model CI Setup

<!-- continuity:task {"acceptance":["Playwright E2E test runs full login, guest mode, file upload, and API key generation flow","multimodal vision verification using Qwen 3.8 Flash audits rendered screenshots for UI/UX quality","fallback vision chain to Qwen 3.8 Omni Flash configured via InferHub","CI gates workflow executes Playwright and vision verification using INFERHUB_API_KEY secret","Dashboard enhanced with CGM visual direction, vector illustrations, and balanced padding"],"depends_on":["OCTO-0200"],"goal":"Setup Playwright E2E and multimodal vision verification with Qwen 3.8 Flash in CI","id":"OCTO-0400","issue_url":"https://github.com/Pukujan/octo-database/issues/3","next_action":"Push PR for Playwright & Vision CI, verify green gates, and auto-merge.","owner":"Pukujan; main agent coordinates implementation","priority":"P1","protocol_version":"0.1.0-draft","schema":"project-continuity.task.v1","status":"active","why":"Ensure frontend UI/UX alignment, padding, and layout integrity are validated by vision models in CI."} -->

- Status: active
- Priority: P1
- Branch: `task/OCTO-0400-playwright-and-vision-ci`
- GitHub issue: https://github.com/Pukujan/octo-database/issues/3

## Goal

Setup Playwright E2E testing and automated multimodal vision verification using Alibaba Qwen 3.8 Flash via InferHub in GitHub Actions CI, auditing UI/UX layout, padding, alignment, and visual appeal per CGM guidelines.

## Prepared on this branch

- Multimodal vision verifier `src/qa/vision-verifier.ts` using `ali/qwen3.8-flash` with automatic fallback to `ali/qwen3.8-omni-flash`
- Playwright E2E test suite `tests/e2e/dashboard-ui.spec.ts` capturing full-page screenshots and executing vision audits
- Playwright configuration `playwright.config.ts` managing Vite (port 3000) and backend server (port 3001) lifecycle
- Dashboard enhanced with CGM visual guidelines (`src/ui/Dashboard.tsx`) with login vector illustration and spacious alignment
- GitHub Actions workflow `.github/workflows/gates.yml` configured with `npx playwright install --with-deps chromium` and `npx playwright test` using repository secret `INFERHUB_API_KEY`

## Checkpoint log

Verified locally that Qwen 3.8 Flash audits rendered screenshots of the Login Screen (score: 86/100) and Authenticated Dashboard (score: 88/100).
Interactive E2E flow (Guest entry, R2 file upload, API key minting, and sign out) passes 100% cleanly.
Repository secret `INFERHUB_API_KEY` configured on `Pukujan/octo-database`.
All local checks (typecheck, tests, ruff, mypy, PCM, CGM, ACS) pass.
