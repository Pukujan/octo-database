# Octo — MFA (TOTP) step-up for workspace creation and key minting (slice design)

Status: **LOCKED** — owner-accepted criteria on issue #126 (Slice 18), following
the roadmap decisions recorded on #122 (2026-10-05). Packet follows
`docs/productization/SLICE_CONTRACT.md`.

Related: issue #126 (owning slice), #122 (parent roadmap), #125 (Slice 17,
introduces the MFA record and the step-up check), #127 (Slice 19, typed keys).

---

## Why this slice exists

Slice 15 stamped three operations with the human confirmation gate: workspace
deletion, workspace creation, and API-key minting. Slice 17 added a per-principal
TOTP second factor and wired it into deletion first, per #125's proposal. This
slice applies the *same* check to the other two stamped operations, so an
MFA-enabled principal must present a current code for all of them.

There is no new mechanism: `confirmGate` already accepts
`{ requireMfa, mfaCode }` and `verifyMfaCode` already handles TOTP and one-time
recovery codes. This slice is an application of the existing check plus the
client prompts, which is why it is small.

---

## PDD — product definition

**User / actor**
Any signed-in principal who creates a workspace or mints an API key and has an
authenticator enrolled. Also the platform owner, who is **not** exempt — MFA
protects the owner's own account too, and the owner may leave it disabled.

**Job**
Have every authority-granting action require the second factor once enrolled, so
a leaked session cannot quietly create a tenancy boundary or mint a credential.

**Why**
Creation mints a tenancy boundary and its first key; minting grants authority.
Both are as consequential as deletion. Leaving them secret-only while deletion
required a code would be an inconsistent, easily-missed gap in the same gate.

**In scope**
- `POST /api/workspaces` and `POST /api/keys` additionally require a valid TOTP
  code **or** a one-time recovery code when the principal has MFA enabled.
- One rule, no policy engine: if MFA is enabled, *all* stamped operations require
  it (creation, minting, deletion).
- The recovery-code set is shared across all stamped operations and remains
  single-use.
- The authenticator-code field appears in the create and mint modals, and in the
  Access page's inline mint form, when MFA is enabled.

**Out of scope**
- WebAuthn / passkeys.
- A per-operation sensitivity threshold or a policy engine deciding which
  operations need MFA.
- Forcing MFA on principals who have not enrolled.
- Any change to the MFA record, enrollment, or the Slice 17 routes.

**Reuse**
- The Slice 17 `confirmGate` `{ requireMfa, mfaCode }` option and `verifyMfaCode`.
- The Slice 17 Access-page Security panel and `state.mfaEnabled`.
- The existing create/mint routes and modals from Slice 15.
- The Slice 16 daily limit, which stays an independent guard after the gate.

**Observable success**
- An MFA-enabled principal's secret-only create → `403 MFA_CODE_INVALID`; the
  same with a code → `201`.
- An MFA-enabled principal's secret-only mint → `403 MFA_CODE_INVALID`; the same
  with a code → `201`.
- A principal without MFA creates and mints with the secret alone.
- An API-key caller is refused regardless of MFA.
- A recovery code satisfies one stamped operation and is refused on the next.
- The create modal asks for a code once MFA is enabled.

---

## SDD — system and interface design

**Authority / canonical state**
Unchanged. `octo.principals` holds the MFA record (Slice 17); `octo.workspaces`
and `octo.api_keys` remain canonical for their operations. No migration.

**Capabilities**
None new. The two routes gain one additional condition on an existing gate.

**API contract**
`POST /api/workspaces` and `POST /api/keys` gain one failure mode when the
principal has MFA enabled, checked inside `confirmGate` **after** the secret
matches and **before** any provisioning/minting:

```
403 { "error": "MFA_CODE_INVALID: A valid authenticator code is required to complete this command." }
```

Success responses and the Slice 16 `429 WORKSPACE_DAILY_LIMIT` (checked after the
gate) are unchanged.

**Provider / data flow**
No new flow. Both routes pass `parsed.mfaCode` into the existing `confirmGate`
call with `requireMfa: true`; `verifyMfaCode` decrypts the stored secret and
verifies the code, falling back to a single-use recovery code.

**Client surfaces**
Frontend only (`src/main.ts`): the create modal, the mint modal, and the Access
page's inline mint form render an authenticator-code input when
`state.mfaEnabled`, and the create/mint submit handlers forward `mfaCode`.

**Existing code reuse / replacement**
- Reuse: everything from Slice 17 (`confirmGate`, `verifyMfaCode`, the Security
  panel, `state.mfaEnabled`).
- Change: the two `confirmGate` call sites; three form render sites; two submit
  handlers.
- Delete: nothing.

**Failure boundary**
- In scope: secret-only create/mint refused when enrolled; code accepted; API-key
  refusal preserved; non-enrolled principals unaffected.
- Out of scope: the Slice 17 failure boundary (clock skew, TOTP replay window,
  no rate limit on code attempts) is inherited unchanged, not re-solved here.
- Out of scope: the Slice 16 TOCTOU window between the daily-limit count and the
  insert is unchanged; this slice adds no new concurrency handling.

---

## EVAL / TDD — completion oracle

**Public deterministic**
- `tests/e2e/mfa-create-mint.spec.ts`: an MFA-enabled principal's secret-only
  create and mint are refused `403 MFA_CODE_INVALID`; the same with a code
  succeed `201`. Covers the accepted job for both operations.

**End-to-end user flow**
- The same spec drives the real create modal in a browser: after enrolling, the
  modal shows the code field and a coded creation completes.

**Metamorphic / property**
- **Change the enrollment state** (opt-in invariant): a non-enrolled principal
  creates and mints with the secret alone.
- **Change the credential class** (gate-ordering invariant): an API-key caller is
  refused for both operations.

**Hidden holdout**
- `tests/e2e/mfa-create-mint-holdout.spec.ts`: a principal satisfies creation
  with a **recovery code** rather than a TOTP code, then presents that same code
  to a *different* stamped operation (minting). The reused code is refused while
  the authenticator still works. Changes meaningful scenario details (credential
  type and operation ordering) while preserving the same claim; an
  implementation that consumed recovery codes per-operation would fail it.

**Production smoke**
- Owner-only: enroll MFA on a throwaway principal, confirm a secret-only create
  is refused and a coded create succeeds, then disable. No production data
  mutated beyond the owner's own test principal.

---

## Lock

Owner accepted: 2026-10-05 — criteria recorded on issue #126. Locked at:
2026-10-05.

---

## Implementation reconciliation

- **One rule, no threshold.** Per #126's research note, MFA applies to *all*
  stamped operations once enabled, rather than a per-operation sensitivity
  threshold — fewer moving parts and no policy engine.
- **Recovery codes are shared and single-use across operations.** The set lives
  on the principal (Slice 17); `verifyMfaCode` consumes a code regardless of
  which route invoked the gate, so a code used to create cannot then mint.
- **No new migration.** The Slice 17 record already holds everything this slice
  needs.
