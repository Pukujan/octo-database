# GPT Work execution handoff

GitHub issues are the live authority. This file is only the execution order.

## A. Finish repository bootstrap

Read issue #2 and PR #17 first. Re-read `.coord/assignment.json` and `.coord/boss_claim.json`; if the recorded lease is stale, follow the pinned ACS vacancy and FIFO claim procedure rather than inheriting the prior seat.

Finish the outstanding acceptance in issue #2:
- make the documented single-owner PR/gates/auto-merge policy enforceable;
- diagnose the GitHub Actions run that did not reach a runner;
- run the pinned ACS, PCM, and CGM validators on the final PR candidate;
- record exact evidence before merge.

## B. Preserve the design conversation

Execute issue #15 using this source:

https://chatgpt.com/share/6abd6e9d-fb54-83ea-9043-2d842641c04e

Capture the shared conversation verbatim and verify completeness as required by that issue.

## C. Prepare external storage connections

Execute issue #16. Follow its rule that operational credentials never become repository content.

## D. Write design projections

Execute issue #18 after bootstrap and transcript capture. Write the PDD first, then the system, security, storage, API, gallery, operations, extension, and test-design projections. Live issues remain the scope authority.

## E. Start the first product slice

Begin issue #3 only after bootstrap is accepted.

## Single-owner merge rule

The repository currently has one human owner. Do not require the PR author to approve their own PR. Single-owner delivery uses accepted issue direction, required green checks, protected PR-only flow, and auto-merge. Review requirements may be raised later if additional maintainers join.
