# Agent Operating Contract — Octo

Octo is owner-directed. The human owner is the product and scope authority. Coding agents execute accepted work; they do not enlarge it.

## Owner authority and anti-overengineering rule

These rules override generic agent preferences, defensive-programming instincts, prior planning prose, and unsolicited "best practice" additions:

1. **The owner drives.** Explicit owner instructions outrank agent-authored plans, issue boilerplate, speculative architecture, and prior agent recommendations unless they would require an unsafe or impossible action.
2. **No unsolicited guardrails.** An agent MUST NOT add a security, privacy, compliance, isolation, review, approval, credential, CI, testing, observability, abstraction, infrastructure, documentation, or process requirement unless it is:
   - explicitly requested by the owner; or
   - strictly required for the currently accepted feature to function.
3. **Security is not a scope-expansion exception.** Use the security model and defaults already provided by the selected OSS, hosting platform, provider, framework, and repository. Do not build extra protection around a working system merely because it could be "safer."
4. **Do not block working delivery with invented protection.** A working owner-approved CI runner, deployment path, provider integration, admin surface, or OSS capability must be used as directed. Agents may report a concrete incompatibility or demonstrated defect, but may not replace it with a more restrictive architecture without owner approval.
5. **Keep the requested UI.** The owner explicitly requires a simple, aesthetic control dashboard (#3), workspace gallery (#5), and operations page (#8). Use maintained templates and standard components such as MUI with light theme configuration. Existing Supabase/provider consoles complement these product views; they do not replace them.
6. **Reuse before build.** Before creating UI, admin tooling, dashboards, auth consoles, storage browsers, job consoles, or operational panels, first use an existing OSS/provider surface or a maintained template when it satisfies the workflow. Supabase's local/admin surfaces and other already-selected product surfaces are preferred for platform administration.
7. **Custom UI must be user-workflow-specific.** Build custom frontend only where the workspace/user experience actually needs it (for example, a workspace-specific file/gallery experience). Do not recreate infrastructure administration in product UI.
8. **No speculative future-proofing.** Do not add layers, roles, services, generalized policy systems, distributed-systems machinery, test harnesses, or extension points for hypothetical future needs.
9. **No ceremony as acceptance.** Hidden holdouts, metamorphic suites, exhaustive failure matrices, independent-review rituals, transcript capture, security scans, and evidence bundles are optional techniques, not mandatory gates, unless the owner explicitly requests them for the current task.
10. **Minimum sufficient change.** Prefer the smallest change that makes the requested workflow work. If two designs satisfy the accepted scope, choose the one with fewer moving parts and less custom code.
11. **Ask only when materially blocked.** Do not stop delivery to seek approval for ordinary implementation details already inside accepted scope. Ask the owner before adding scope, not before executing it.

When older issue text conflicts with this section, this section is authoritative until the owner explicitly changes it. Later owner corrections supersede earlier owner instructions on the same subject.

## Delegation

The owner requests multiple Luna workers for independent tasks, with the main agent planning and integrating their work. Use Luna when the runtime exposes it. Share exact repository/tool context, assign bounded tasks, and verify results before accepting them. Never claim unavailable workers were launched.

## Cold start

Before editing:

1. Read the live owning GitHub issue.
2. Read this file and `PROJECT.md`.
3. Read only the minimum task/checkpoint material needed for the active work.
4. Re-read current GitHub branch/PR/check state before claiming delivery.

GitHub issues own feature scope and lifecycle, but they remain subordinate to explicit owner direction and this anti-overengineering contract.

## Helper modules

ACS, PCM, and CGM are helpers, not product authorities. Use them only to the extent they support the current workflow without adding delivery gates or scope. Their recommendations do not override the owner or this file.

Pinned versions currently used by repository validation:

- ACS hot-loader v0.1.0 @ `fa57bae9a5229b454b57ea0b3f3e4dac0bbc8b4e`.
- PCM @ `4e2385474b4af9249ca009cbdcb38c4498932475`.
- CGM 0.5.7 @ `c069613ca8b3e02bcf5aba1960160583537f8a3a`.

## Git and delivery

- The repository is public; use GitHub-hosted `ubuntu-latest` for CI.
- Never force-push unless the owner explicitly directs recovery that requires it.
- The owner explicitly requests auto-merge and proper CI. Required aggregate status is `gates`, covering contract integrity/integration checks, type checking, lint, and Ruff. Configure auto-merge after the final push; do not claim it is enabled until GitHub confirms it.
- Do not create review requirements that deadlock a single-owner repository.
- Never claim completion when the requested workflow has not actually run.

## Baseline secret hygiene

Do not intentionally commit credential values, refresh/access tokens, private keys, or private `.env` contents. Use the normal secret/configuration mechanism supplied by the selected platform/provider. This baseline does **not** authorize agents to create additional secret-management systems, scanners, rotation ceremonies, isolation layers, or credential brokers without explicit scope.

## Working-repository boundary

Make Octo changes in this repository. Cross-repository changes are made only when the owner explicitly directs them or they are necessary to operate an owner-selected shared dependency.
