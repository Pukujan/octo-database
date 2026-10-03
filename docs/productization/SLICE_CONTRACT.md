# Octo Productization Slice Contract

This is the reusable contract for AI-first delivery in Octo.

The purpose is simple: define what success means before implementation, keep the implementation agent inside accepted scope, and make completion depend on observable product behavior rather than agent confidence.

## Authority

1. **Owner** — owns product intent, tradeoffs, scope, and final acceptance/correction.
2. **Planning model** — drafts the PDD, SDD, and eval/TDD packet from owner intent.
3. **Independent critic** — challenges ambiguity, missing user outcomes, overbuilding, and weak evals.
4. **Owner** — accepts or corrects the packet. Acceptance locks the slice.
5. **Implementation agents** — implement the locked slice. They do not redefine success to fit their implementation.

An implementation agent may propose a correction when the contract is impossible or contradictory, but must not silently change it.

## Required slice packet

Keep this compact. It should normally fit in the owning GitHub issue or one linked design document.

### PDD — product definition

**User / actor**
Who is trying to do the job?

**Job**
What concrete outcome must they achieve?

**Why**
Why does this slice matter now?

**In scope**
What must work in this slice?

**Out of scope**
What must not be added just because it might be useful, safer, more general, or future-proof?

**Reuse**
Which existing Octo behavior, mature system, provider feature, or maintained component should be reused?

**Observable success**
What would we be able to observe if the slice genuinely works?

### SDD — system and interface design

**Authority / canonical state**
Where does the durable truth live?

**Capabilities**
Which workspace capabilities are required?

**API contract**
What requests/responses/events must exist?

**Provider/data flow**
How do PostgreSQL, R2, Drive, Parquet/DuckDB, graph/vector projections, GitHub, or other selected systems participate?

**Client surfaces**
Which of frontend, SDK, CLI, MCP, or provider-native UI are involved?

**Existing code**
What should be reused, adapted behind the new API, replaced, or deleted?

**Failure boundary**
Which failures are in scope for this slice? Do not expand this into an exhaustive hypothetical failure matrix.

### EVAL / TDD — completion oracle

Tests exist to prove the accepted claim, not maximize test count.

**Public deterministic evals**
Contract, unit, integration, migration, or state-transition checks that implementers may see.

**End-to-end user eval**
The real user job, executed through the intended product surface where applicable.

**Metamorphic/property evals**
Only invariants that should remain true when inputs/environment change.

Examples:
- changing machine identity must not change canonical workspace state;
- moving a logical file between R2 and Drive must not change its logical identity;
- deleting a rebuildable local cache must not destroy durable state;
- SDK, CLI, MCP, and frontend calls that express the same capability should have equivalent server semantics.

**Hidden holdout**
Optional. Use only when an implementation agent could plausibly overfit the public fixtures or falsely claim end-to-end success.

A useful holdout changes meaningful scenario details: unseen workspace/data, action ordering, storage placement, filenames, machine state, or other inputs while preserving the same success claim.

Do not hide implementation trivia merely to surprise the agent.

**Production smoke**
The smallest post-deploy check needed to prove the deployed runtime actually supports the accepted job.

## Lock rule

A slice is ready for implementation when:

- the user job is unambiguous;
- scope and out-of-scope boundaries are explicit;
- the main data/API ownership is defined;
- observable success is defined;
- required eval classes are named;
- the owner has accepted or corrected the packet.

After lock, implementers work against the contract.

Changing the product outcome requires an owner correction on the owning issue. Changing an ordinary implementation detail within the accepted SDD does not.

## Done rule

A slice is done only when:

1. the accepted user job works end to end;
2. required public evals pass;
3. required targeted metamorphic/property evals pass;
4. any declared hidden holdout passes;
5. required repository CI is green on the exact candidate;
6. production smoke passes when deployment is part of the slice;
7. the implementation has not added out-of-scope product/security/process machinery.

Passing unit tests alone is not completion. Compiling is not completion. An implementation agent's self-assessment is not completion.

## Security and edge-case rule

Use selected platforms/frameworks/providers and their normal security defaults plus explicit Octo invariants.

Security, privacy, hardening, abstraction, or rare edge-case ideas do not become product scope merely because an agent considers them prudent.

Add them when:

- the owner explicitly requests them;
- the accepted user job requires them to function; or
- a demonstrated failure in the accepted slice requires correction.

Do not use this rule to bypass explicit security requirements already present in the slice.


## Progressive robustness

Do not choose between "ship weak software" and "harden everything before anyone can use it." Build robustness in levels.

### Level 1 — Working slice

Required before the slice can be considered functionally implemented:

- the primary user job works end to end;
- canonical state and ownership are correct;
- the API contract is coherent;
- normal error handling exists for expected failures;
- deterministic tests cover the important logic;
- at least one real end-to-end path proves the user job.

This is not a throwaway prototype. It is the smallest implementation that is structurally correct for the accepted job.

### Level 2 — Production-ready slice

Required before ordinary production use:

- Level 1 remains green;
- real provider/database integration is exercised;
- retries/idempotency/transaction boundaries exist where the actual operation needs them;
- data migrations and recovery behavior are defined where state can be changed durably;
- one or more variant/metamorphic checks cover important invariants;
- production smoke verifies the deployed path;
- basic operational visibility exists for failures that would otherwise be invisible.

Do not generalize these mechanisms beyond the slice.

### Level 3 — Hardened slice

Add only when justified by real exposure or consequence.

Triggers include:

- high-frequency or high-volume use;
- meaningful external/user exposure;
- irreversible or expensive operations;
- repeated production failures;
- demonstrated abuse/threat patterns;
- material performance/reliability limits;
- explicit owner requirement.

Possible hardening includes stronger recovery, concurrency handling, rate/scale work, additional failure-mode tests, more detailed observability, stronger approval boundaries for high-impact actions, or provider redundancy.

A hypothetical edge case by itself is not a hardening trigger.

### Robustness decision rule

For each proposed robustness task, ask:

1. **Likelihood** — is this failure common, observed, or credible in the current use?
2. **Blast radius** — what is affected if it happens?
3. **Irreversibility** — can we recover cheaply?
4. **Exposure** — is this local/internal, owner-only, or externally used?
5. **Cost of delay** — does solving it now delay validation of the primary job?

Increase robustness when the first four materially outweigh the fifth.

If not, record the risk or observation and continue shipping.

### Test-depth rule

Weak testing is not the same thing as limited hardening.

Every slice still requires tests strong enough to prove its accepted claims. Additional test breadth follows the same progressive rule:

- always test the primary contract and end-to-end job;
- add variant/property tests for important invariants;
- add hidden holdouts when false completion/overfitting is plausible;
- add broad failure matrices only after production exposure, repeated failures, or explicit scope justifies them.

The goal is **minimum sufficient robustness, not minimum testing**.

## Frontend slices

For product-facing UI, the eval must describe real tasks rather than screenshots alone.

Use the same:
- user jobs;
- workspace API;
- design tokens/components;
- content/surface direction;
- test data.

Candidate UIs may compete during the bounded frontend bakeoff. Evaluation should include task completion, clear next actions, accessibility checks, visual consistency/regression, and owner taste judgment.

Do not let the implementation agent invent a new design system for each screen.

## Default execution loop

owner intent
→ planning model drafts PDD/SDD/EVAL
→ independent critique
→ owner accepts/corrects
→ slice locks
→ implementation agent builds
→ public evals
→ targeted variant/holdout evals if declared
→ production smoke if applicable
→ done or fix

## Minimal copy/paste template

```md
## PDD
User/actor:
Job:
Why:
In scope:
Out of scope:
Reuse:
Observable success:

## SDD
Authority/canonical state:
Capabilities:
API contract:
Provider/data flow:
Client surfaces:
Existing code reuse/replacement:
Failure boundary:

## EVAL / TDD
Public deterministic:
End-to-end user flow:
Metamorphic/property:
Hidden holdout: none | <description>
Production smoke:

## Lock
Owner accepted/corrected:
Locked at:
```
