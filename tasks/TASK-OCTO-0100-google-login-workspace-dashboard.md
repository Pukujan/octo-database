# OCTO-0100 Google login, workspace entry, and simple control dashboard

<!-- continuity:task {"acceptance":["approved owner signs in with Google","Octo creates/resolves one stable user principal","dashboard lists exactly authorized workspaces","entering Personal works","second unapproved account cannot enumerate or access Personal by URL/API guessing","logout/session revocation blocks subsequent access","browser contains no service-role/master credential","frontend type checking and tests pass"],"depends_on":["OCTO-0001"],"goal":"Deliver Google login, workspace entry, and simple control dashboard","id":"OCTO-0100","issue_url":"https://github.com/Pukujan/octo-database/issues/3","next_action":"Push PR #20, verify gates on GitHub-hosted runner, and merge via auto-merge.","owner":"Pukujan; main agent coordinates implementation","priority":"P1","protocol_version":"0.1.0-draft","schema":"project-continuity.task.v1","status":"active","why":"Establish canonical principal and workspace boundary for personal control plane."} -->

- Status: active
- Priority: P1
- Branch: `task/OCTO-0100-google-login-workspace-dashboard`
- GitHub issue: https://github.com/Pukujan/octo-database/issues/3

## Goal

Deliver the first real product path: Google sign-in → Octo identity → authorized workspace list → private workspace dashboard. This slice establishes the principal/workspace boundary every later file, gallery, agent, and analytics feature depends on.

## Prepared on this branch

- Canonical PostgreSQL migration with Row-Level Security: `supabase/migrations/20261001000000_slice1_principals_workspaces_memberships.sql`
- Supabase Auth session lifecycle & Google OAuth: `src/auth/session.ts`
- Database-backed authorization engine with RLS: `src/auth/authorization.ts`
- Workspace entry and membership service: `src/auth/workspace-service.ts`
- React MUI control dashboard with light theme: `src/ui/Dashboard.tsx` and `src/ui/theme.ts`
- Full test suite: unit, integration, security-negative, and SQL schema validation

## Checkpoint log

Implemented canonical tables (`octo.principals`, `octo.workspaces`, `octo.workspace_memberships`) with PostgreSQL Row-Level Security policies.
Verified in real PostgreSQL 16 that creator bootstrap membership succeeds, non-member workspace list returns 0 rows, direct ID guessing is blocked, and client self-promotion to platform owner is rejected by RLS.
Unit, integration, and security-negative TypeScript test suites pass cleanly with strict types (`tsc --noEmit`) and vitest.
