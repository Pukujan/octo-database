# Handoff

Fresh agents should start here only after reading `PROJECT.md` and `checkpoints/CURRENT.md`.

## Read order

1. Live GitHub issue for the active task.
2. `PROJECT.md`.
3. `checkpoints/CURRENT.md`.
4. Active `tasks/TASK-OCTO-*.md`.
5. Only the minimum relevant plan/spec linked by the issue.

Do not reconstruct project direction from old chat history when a live issue answers the question.

## External helper pins

The repository is an adopter, not the source repository, for these helpers:

- Agent Custom Setup hot-loader: `Pukujan/agent-custom-setup`, module `multi-agent-hotload` v0.1.0.
- Project Continuity Modules: commit `4e2385474b4af9249ca009cbdcb38c4498932475`, CLI 0.6.0, protocol 0.1.0-draft.
- Content Generation Modules: version 0.5.7, commit `c069613ca8b3e02bcf5aba1960160583537f8a3a`, all eight modules.

Pin/reference them; do not vendor their repositories into Octo.

## GitHub delivery contract

After the empty-repository seed, work is PR-only. Required target controls:

- one approving human review;
- required status check named exactly `gates`;
- force-push and deletion of main blocked;
- repository auto-merge enabled; squash is preferred;
- auto-merge armed only after the final task push.

Missing or unverified controls fail closed for declaring a task delivered.

## Chat transcript source

The original design conversation must later be captured verbatim by GPT Work under issue #15 from:

https://chatgpt.com/share/6abd6e9d-fb54-83ea-9043-2d842641c04e

If the page cannot be captured completely, issue #15 must record the blocker rather than inventing a transcript.

## Secrets

Credential onboarding is issue #16. Never place actual Google/R2 credentials in repository files, issue comments, PR bodies, or transcript artifacts.
