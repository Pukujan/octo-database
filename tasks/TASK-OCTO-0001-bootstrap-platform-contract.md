# OCTO-0001 — Bootstrap the platform contract

<!-- continuity:task {"acceptance":["minimal seed creates main and all substantive bootstrap changes land through a PR","full PCM adopter continuity files and pinned schemas are present","full CGM 0.5.7 adapter lists all eight modules and passes pinned validation","CI exposes a job named exactly gates","desired GitHub rules require one human approval, gates, blocked force-push/deletion, and auto-merge when green","repository settings that cannot be changed through the current connector are recorded as an explicit blocker/follow-up","no secrets are stored"],"depends_on":[],"goal":"Initialize Octo as a full ACS hot-loader adopter with PCM-governed GitHub progression, full CGM writing contracts, deterministic validation, and documented gated merge policy.","id":"OCTO-0001","issue_url":"https://github.com/Pukujan/octo-database/issues/2","next_action":"Open the bootstrap pull request, verify gates on its exact head, apply the GitHub ruleset/auto-merge settings through an admin-capable surface, then merge.","owner":"first active ACS decision boss / GitHub owner Pukujan","priority":"P0","protocol_version":"0.1.0-draft","schema":"project-continuity.task.v1","status":"active","why":"The repository began empty; every later storage, auth, gallery, agent, graph, and analytics slice needs one durable governance and continuity contract before implementation starts."} -->

- Status: active
- Owner: first active ACS decision boss / GitHub owner Pukujan
- Priority: P0
- Depends on: none
- Branch: `task/OCTO-0001-bootstrap-platform-contract`
- GitHub issue: https://github.com/Pukujan/octo-database/issues/2

## Goal

Initialize Octo as a full ACS hot-loader adopter with PCM-governed GitHub progression, full CGM writing contracts, deterministic validation, and a documented gated merge policy.

## Acceptance criteria

- [ ] Minimal empty-repository seed is the only bootstrap direct-main exception.
- [ ] PCM config/project/current/task projections and exact pinned schemas validate.
- [ ] CGM adapter uses 0.5.7 pin and all eight modules.
- [ ] `gates` checks JSON plus pinned PCM and CGM validation.
- [ ] Desired GitHub controls are one human approval + `gates` + no force/deletion + auto-merge.
- [ ] Connector-limited settings are clearly handed off instead of being falsely marked done.
- [ ] No secrets are stored.

## Checkpoint — 2026-09-30

Completed:
- Created program and slice issues #1–#16 before adding deeper specs.
- Created the minimum main seed required by an empty repository.
- Created this task branch.
- Added the adopter contracts and deterministic validation workflow in this increment.

Observed blocker:
- The connected GitHub surface exposes per-PR auto-merge but not repository settings/ruleset mutation; repo-level `allow_auto_merge` was observed false before this change.

Next:
- Open/verify the bootstrap PR, then apply the repository ruleset and auto-merge setting through an admin-capable surface before treating governance setup as complete.
