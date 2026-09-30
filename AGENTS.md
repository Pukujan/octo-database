# Agent Operating Contract — Octo

Octo is the working repository. ACS, PCM, and CGM are helpers only.

## Cold start

Before editing:

1. Read the live owning GitHub issue.
2. Read `.coord/assignment.json` and `.coord/boss_claim.json` when coordination is active; re-check the lease/claim before boss-only actions.
3. Read `PROJECT.md`.
4. Read `checkpoints/CURRENT.md`.
5. Read the active `tasks/TASK-OCTO-*.md`.
6. Read only the minimum linked plan/spec.
7. Re-read current GitHub branch/PR/check state before claiming delivery.

GitHub issues own task scope, acceptance, dependencies, ownership, and lifecycle. Repository task/current files are versioned projections.

## Full hot-load requirement

Use the complete stacks:

- ACS hot-loader v0.1.0 @ `fa57bae9a5229b454b57ea0b3f3e4dac0bbc8b4e`.
- PCM @ `4e2385474b4af9249ca009cbdcb38c4498932475` / CLI 0.6.0.
- CGM 0.5.7 @ `c069613ca8b3e02bcf5aba1960160583537f8a3a`, all eight modules.

ACS join/continue order, boss lease, claim queue, zombie, watchdog, proposal, and working-repo rules remain binding. A returning or stale boss never auto-reclaims.

## Git and delivery

- The one-time empty-repository seed is the only direct-main bootstrap exception.
- One primary writer owns an active task branch/checkpoint stream.
- Never force-push.
- Required status check is `gates`.
- **Single-owner mode:** do not require an impossible self-review. Use 0 external approvals, accepted issue direction, green required gates, protected PR-only flow, and auto-merge.
- If additional maintainers join, change review requirements only through an accepted issue.
- Never claim completion while settings/checks/merge facts are unverified.

## Human-facing writing

Apply the pinned CGM routing. README/product entry → writing-direction. Other human-facing GitHub/docs/HTML prose → human-sounding-writing. Generated artifact/media basenames → human-output-naming.

## Security

Never commit or print credentials, refresh/access tokens, cookies, service keys, private .env contents, or secret-bearing backups. Agents receive Octo-scoped capabilities rather than infrastructure master credentials.

## Working-repository boundary

Code, claims, PRs, and boss actions are limited to this repository while Octo is the hot-loaded working repo. Cross-repo findings may be proposed as issues on their owning repository, not implemented there without that project's own authority.
