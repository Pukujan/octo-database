# Handoff

Fresh agents should start here only after reading the live issue and coordination state.

## Read order

1. Live GitHub issue for the active task.
2. `.coord/assignment.json` and `.coord/boss_claim.json` when ACS coordination is active.
3. `PROJECT.md`.
4. `checkpoints/CURRENT.md`.
5. Active `tasks/TASK-OCTO-*.md`.
6. Only the minimum relevant plan/spec linked by the issue.

Do not reconstruct project direction from old chat history when a live issue answers the question.

## External helper pins

- ACS multi-agent hot-loader v0.1.0: `Pukujan/agent-custom-setup` @ `fa57bae9a5229b454b57ea0b3f3e4dac0bbc8b4e`.
- PCM: `Pukujan/project-continuity-modules` @ `4e2385474b4af9249ca009cbdcb38c4498932475`, CLI 0.6.0.
- CGM: `Pukujan/content-generation-modules` 0.5.7 @ `c069613ca8b3e02bcf5aba1960160583537f8a3a`, all eight modules.

Pin/reference them; do not vendor their repositories into Octo.

## GitHub delivery contract

After the empty-repository seed, work is PR-only. Current single-owner target controls:

- **0 required external approvals** while only the owner maintains the repository;
- required status check named exactly `gates`;
- force-push and deletion of main blocked;
- repository auto-merge enabled; squash preferred;
- auto-merge armed only after the task's final push and accepted issue direction.

If additional human maintainers join, review requirements may be increased through an accepted issue. Missing or unverified controls fail closed for declaring a task delivered.

## Known bootstrap blockers

- Repository-level `allow_auto_merge` was observed false.
- No main ruleset was present.
- Actions run 36773617802 created `gates` but never reached a runner (runner_id=0, no executed steps/log blob).

These are Work/admin follow-ups, not permission to weaken the gate.

## Chat transcript source

Issue #15 requires GPT Work to open and capture this source verbatim:

https://chatgpt.com/share/6abd6e9d-fb54-83ea-9043-2d842641c04e

If incomplete or inaccessible, record the blocker instead of inventing a transcript.

## Secrets

Credential onboarding is issue #16. Never place Google/R2 credentials in repository files, comments, PRs, transcript artifacts, or ordinary logs.
