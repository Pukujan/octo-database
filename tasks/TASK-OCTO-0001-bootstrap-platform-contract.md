# OCTO-0001 — Bootstrap the platform contract

<!-- continuity:task {"acceptance":["minimal seed creates main and all substantive bootstrap changes land through a PR","full PCM adopter continuity files and pinned schemas are present","full CGM 0.5.7 adapter lists all eight modules and passes pinned validation","ACS adopter assignment and lease/claim state are present and pinned","CI exposes a job named exactly gates","single-owner GitHub rules require PR plus gates, block force-push/deletion, and enable auto-merge with zero external approvals","repository settings that cannot be changed through the current connector are recorded as an explicit blocker/follow-up","no secrets are stored"],"depends_on":[],"goal":"Initialize Octo as a full ACS hot-loader adopter with PCM-governed GitHub progression, full CGM writing contracts, deterministic validation, and a single-owner gated auto-merge policy.","id":"OCTO-0001","issue_url":"https://github.com/Pukujan/octo-database/issues/2","next_action":"GPT Work/admin-capable session must apply the main ruleset and repository auto-merge setting, resolve the Actions runner blocker, run pinned ACS/PCM/CGM validation, and merge only after genuine green gates.","owner":"active ACS decision boss / GitHub owner Pukujan","priority":"P0","protocol_version":"0.1.0-draft","schema":"project-continuity.task.v1","status":"active","why":"Every later storage, auth, gallery, agent, graph, and analytics slice needs one durable governance, coordination, and continuity contract before implementation starts."} -->

- Status: active
- Priority: P0
- Branch: `task/OCTO-0001-bootstrap-platform-contract`
- GitHub issue: https://github.com/Pukujan/octo-database/issues/2

## Goal

Initialize Octo as a full ACS hot-loader adopter with PCM-governed progression, full CGM contracts, deterministic validation, and a single-owner gated auto-merge policy.

## Completed in the branch

- Program/slice issues #1–#16 were created before deeper specs.
- Minimal main seed created the only direct-main bootstrap exception.
- PCM adopter state and exact schemas added.
- Full CGM 0.5.7 eight-module adapter added.
- `gates` workflow added.
- ACS assignment + claim state added.
- Issue #18 now owns later PDD/system/security/API/TDD projections.

## Outstanding acceptance

- Apply main ruleset: PR required, `gates` required, block deletion/force push, 0 external approvals in single-owner mode.
- Enable repository Allow auto-merge.
- Resolve or understand the hosted Actions run that never reached a runner.
- Run pinned ACS hotload_check + PCM validate + CGM adapter validation and record exact outputs.
- Merge only after real gate evidence.

## Next

GPT Work follows `planning/WORK_HANDOFF.md` Stage A.
