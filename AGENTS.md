# Agent Operating Contract — Octo

Octo is the working repository. ACS, PCM, and CGM are helpers only.

## Cold start

Before editing:

1. Read the live owning GitHub issue.
2. Read `PROJECT.md`.
3. Read `checkpoints/CURRENT.md`.
4. Read the active `tasks/TASK-OCTO-*.md`.
5. Read only the minimum linked plan/spec.
6. Re-read the current GitHub branch/PR state before claiming delivery.

GitHub issues own task scope, acceptance, dependencies, ownership, and lifecycle. Repository task/current files are versioned projections.

## Full hot-load requirement

Use the complete stacks, not slim subsets:

- PCM @ `4e2385474b4af9249ca009cbdcb38c4498932475` / CLI 0.6.0.
- CGM 0.5.7 @ `c069613ca8b3e02bcf5aba1960160583537f8a3a`, all eight modules.
- ACS multi-agent-hotload v0.1.0 runtime for join-order roles, lease/claim queue/watchdog/proposal behavior when multiple agents participate.

Follow the pinned ACS HOTLOAD and BEHAVIOR documents rather than duplicating or silently modifying their policy here.

## Git and delivery

- After the one-time empty-repository seed, never commit directly to main.
- One primary writer owns an active task branch/checkpoint stream.
- Never force-push.
- Keep issue, task projection, CURRENT/HANDOFF, and relevant docs synchronized before final task push.
- Required status check is `gates`.
- Intended merge policy is one approving human + green gates + auto-merge.
- Do not claim completion while repository settings/checks/merge facts are unverified.

## Human-facing writing

For every human-facing issue, PR, commit subject/body, documentation page, HTML report, or comparison artifact, apply the pinned CGM writing routing. README/product entry uses writing-direction; other human-facing prose uses human-sounding-writing; generated media/output basenames use human-output-naming.

## Security

Never commit or print credentials, refresh tokens, access tokens, cookies, service keys, private .env contents, or secret-bearing backups. Agent principals should receive Octo-scoped capabilities rather than infrastructure master credentials.

## Working-repository boundary

Code, claims, PRs, lease/boss actions, and task writes are limited to this repository when Octo is the hot-loaded working repo. Cross-repo findings may be proposed as issues on the owning repo but must not mutate its code unless explicitly working there under its own authority.
