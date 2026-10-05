# Octo — MFA (TOTP) step-up for destructive commands (slice design)

Status: **LOCKED** — owner-accepted criteria on issue #125 (Slice 17), following
the roadmap decisions recorded on #122 (2026-10-05). Packet follows
`docs/productization/SLICE_CONTRACT.md`.

Related: issue #125 (owning slice), #122 (parent roadmap), #124 (Slice 16,
workspace-creation limit), #126 (Slice 18, extends this to create/mint), #127
(Slice 19, typed keys).

---

## Why this slice exists

Slice 15 routed the destructive commands (`DELETE /api/workspaces/:id`,
`POST /api/workspaces`, `POST /api/keys`) through the human confirmation gate:
an API-key caller is refused outright, and a human session must present a
confirmation secret. That defends against an agent holding a key, but a
**hijacked or shoulder-surfed browser session** that knows the confirmation
secret can still delete a workspace. This slice adds a second, independent,
per-principal factor — a TOTP code from an authenticator app — so the secret
alone is no longer sufficient once a principal opts in.

The owner's accepted direction (#125): TOTP first (authenticator app, 6-digit
codes, recovery codes for lockout); WebAuthn/passkeys are a later slice.
Enrollment is **opt-in per principal**, so the slice ships without locking
anyone (including the owner) out.

---

## PDD — product definition

**User / actor**
Any signed-in principal who performs a destructive command — deleting a
workspace today, creating/minting in Slice 18. Also the platform owner, who must
be able to enroll, disable, and recover.

**Job**
Prove, at the moment of a destructive command, that the human is present with a
second factor they hold, not merely that a session knows a shared secret.

**Why**
The confirmation secret is a single shared factor. A second factor the session
does not carry closes the remaining gap where a leaked session plus a known
secret is enough to destroy a tenant.

**In scope**
- A per-principal MFA record: an encrypted TOTP secret, a confirmed-at stamp,
  and hashes of one-time recovery codes.
- Enrollment: begin (mint a secret, return its `otpauth://` URI/secret once),
  confirm with a current code, and only then activate.
- Step-up: `DELETE /api/workspaces/:id` additionally requires a valid current
  TOTP code **or** a one-time recovery code when the principal has MFA enabled.
- Recovery codes: ten issued at confirmation, each single-use (consumed on use),
  rotatable.
- Disable: reversible, so a lost authenticator cannot lock an account out
  (a current code or a recovery code authorizes it).
- A client surface in the Access page (status, enroll, rotate, disable) and an
  authenticator-code field in the delete modal when MFA is enabled.
- API-key callers remain refused before any MFA check.

**Out of scope**
- WebAuthn / passkeys (later slice).
- MFA on reads or non-destructive writes.
- MFA on workspace creation and key minting (Slice 18) — this slice wires the
  delete path first, per #125.
- A new secret-management system: the TOTP secret is enveloped with the
  platform's existing env-injected secret mechanism (AGENTS.md #3).
- SMS/email OTP, push approval, device trust, or "remember this device".
- Any generalized policy/step-up engine.

**Reuse**
- Existing `confirmGate` (`src/server/index.ts`) — MFA is an **additional**
  condition on the same gate, never a replacement.
- Existing `octo.principals` table and its per-principal secret pattern
  (`confirm_secret_hash`).
- Existing `hashApiKeySecret` for recovery-code hashing.
- Existing `queryService` trusted path for reading/writing identity material.
- Existing Access page and delete modal in `src/main.ts`.
- `otplib` (maintained OSS) for TOTP generation/verification.

**Observable success**
- With MFA enabled, a delete carrying only the confirmation secret → `403`
  `MFA_CODE_INVALID`.
- The same delete with a valid current code → `200`.
- A recovery code works once and is then refused.
- API-key callers are refused regardless of MFA.
- A principal without MFA enrolled deletes exactly as before (opt-in).
- Disable restores secret-only deletion.
- The Access page shows MFA status and the delete modal asks for a code only
  when MFA is enabled.

---

## SDD — system and interface design

**Authority / canonical state**
`octo.principals` remains canonical. Three columns hold the MFA record beside
`confirm_secret_hash`: `mfa_secret_encrypted` (AES-256-GCM envelope), 
`mfa_confirmed_at`, and `mfa_recovery_code_hashes TEXT[] NOT NULL DEFAULT '{}'`.
An unconfirmed enrollment has a secret but a null `mfa_confirmed_at`, so
"pending" and "active" are distinguishable without a separate table.

**Capabilities**
None new to the workspace capability model. MFA is an identity step-up on the
destructive commands already gated.

**API contract**
Human-session only (an API key is refused on every MFA route):

```
GET  /api/me/mfa                      -> { enabled, confirmedAt, recoveryCodesRemaining }
POST /api/me/mfa/begin                -> { secret, otpauthUri }   (secret shown once)
POST /api/me/mfa/confirm  { code }    -> { recoveryCodes }         (one-time)
POST /api/me/mfa/disable  { code }    -> { disabled: true }
POST /api/me/mfa/recovery-codes { code } -> { recoveryCodes }      (one-time)
```

`DELETE /api/workspaces/:id` gains one failure mode when MFA is enrolled:

```
403 { "error": "MFA_CODE_INVALID: A valid authenticator code is required to complete this command." }
```

`GET /api/me` additionally returns `mfaEnabled` and
`mfaRecoveryCodesRemaining` so the client can render the right affordances.

**Provider / data flow**
- Migration `20261001100000_slice17_principal_mfa.sql` adds the three columns.
- `src/lib/mfa.ts`: `generateTotpSecret`, `totpProvisioningUri`,
  `verifyTotpCode` (±30s tolerance), `generateRecoveryCodes`,
  `hashRecoveryCode`, and the AES-256-GCM `encryptSecret`/`decryptSecret`
  envelope keyed by `sha256(OCTO_MFA_SECRET)`.
- `src/server/db.ts`: `dbGetMfa`, `dbSetMfaPending`, `dbConfirmMfa`,
  `dbSetMfaRecoveryCodes`, `dbClearMfa` — all on `queryService` (trusted path,
  like `confirm_secret_hash`).
- `confirmGate` takes `{ requireMfa, mfaCode }`; after the secret matches, if
  `requireMfa` and the principal is confirmed, `verifyMfaCode` must succeed.
- `verifyMfaCode` decrypts the secret and verifies the TOTP, else matches and
  consumes a recovery-code hash. Every failure path (missing key, malformed
  record, bad code) fails **closed**.

**Client surfaces**
Frontend only (`src/main.ts`): the Access page gains a Security panel (status,
set up, rotate, disable) and the delete modal gains an authenticator-code field
when `state.mfaEnabled`.

**Existing code reuse / replacement**
- Reuse: `confirmGate`, `hashApiKeySecret`, `queryService`, the Access page,
  the delete modal, the existing `api()` error rendering.
- Change: `confirmGate` signature; the delete route passes `requireMfa`; `/api/me`
  reports MFA status; `main.ts` gains the panel, modal, and form handlers.
- Delete: nothing.

**Failure boundary**
- In scope: secret-only delete refused; wrong/expired code refused; used
  recovery code refused; API-key caller refused; unenrolled principal unaffected;
  disable reversible.
- Out of scope: clock skew beyond the ±30s tolerance (the operator's
  authenticator and the host are expected to be roughly synced; the tolerance
  absorbs normal drift, not a broken clock).
- Out of scope: replay within the same 30s step is possible for TOTP by design;
  the recovery path is single-use and the TOTP window is the standard trade-off,
  not hardened further here.
- Out of scope: rate-limiting enrollment or code attempts (no such guard was
  requested; the delete path already requires a valid human session and secret).
- Known limitation recorded: losing both the authenticator and every recovery
  code is not self-service recoverable; disable requires a current factor. This
  is the accepted lockout trade-off, not an oversight.

---

## EVAL / TDD — completion oracle

**Public deterministic**
- `tests/unit/mfa.test.ts`: TOTP verify (current/wrong/foreign secret/malformed),
  provisioning URI, recovery-code generation/hashing, and the encrypt/decrypt
  envelope (round-trip, random IV, tamper rejection, wrong-key rejection,
  fail-closed when `OCTO_MFA_SECRET` is absent).
- `tests/test_slice17_schema.py`: the migration adds the three columns
  idempotently with the right nullability and default.

**End-to-end user flow**
- `tests/e2e/mfa-step-up.spec.ts`: enroll via the API, then drive the real
  delete route — secret-only is refused `403 MFA_CODE_INVALID`, a current code
  succeeds `200`.

**Metamorphic / property**
- **Change the enrollment state** (opt-in invariant): a principal that never
  enrolled deletes with the secret alone.
- **Change the credential class** (gate-ordering invariant): an API-key caller is
  refused regardless of the principal's MFA state.
- **Recovery consumption**: a recovery code works once; the same code is refused
  on reuse.
- **Reversibility**: disable restores secret-only deletion.

**Hidden holdout**
- `tests/e2e/mfa-step-up-holdout.spec.ts`: a principal enrolls, then **rotates**
  its recovery codes. A code from the retired set is refused while a code from
  the current set completes the delete. Changes meaningful scenario details
  (unseen rotation ordering) while preserving the same claim; an implementation
  that appends instead of replacing the set fails it.

**Production smoke**
- Owner-only: enroll an authenticator on a throwaway principal, confirm a
  secret-only delete is refused and a coded delete succeeds, then disable. No
  production data mutated beyond the owner's own test principal.

---

## Lock

Owner accepted: 2026-10-05 — criteria recorded on issue #125. Locked at:
2026-10-05.

---

## Implementation reconciliation

- **Delete path first.** Per #125's proposal step 4, only
  `DELETE /api/workspaces/:id` passes `requireMfa` in this slice; Slice 18
  extends the same `confirmGate` option to create/mint.
- **Envelope reuses the platform secret mechanism.** The TOTP secret cannot be
  hashed (verification needs the original), so it is encrypted at rest with a key
  derived from `OCTO_MFA_SECRET` — the same env-injected secret mechanism the
  platform already uses — rather than a new secret-management system.
- **Recovery codes reuse the API-key hash.** They are high-entropy, so a plain
  hash (as for API keys) is sufficient; they are single-use and replaced on
  rotation.
- **Trusted path for the record.** MFA is per-principal identity material like
  `confirm_secret_hash`, read and written through `queryService`, not the
  RLS-fenced request pool.
