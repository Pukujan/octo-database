# Octo — Typed multi-tenant keys (slice design)

Status: **LOCKED** — owner-accepted criteria on issue #127 (Slice 19), following
the roadmap decisions recorded on #122 (2026-10-05). Packet follows
`docs/productization/SLICE_CONTRACT.md`.

Related: issue #127 (owning slice), #122 (parent roadmap), #61 (the `admin`
scope accepted but never enforced), #72 (control-plane / provisioned-DB
research, which is where a raw-SQL surface would live).

---

## Why this slice exists

Every Octo key is a bag of scopes (`read/write/files/delete/admin`) with no
notion of *who* holds it. A consumer that only ever needs to read — an analytics
dashboard, a retrieval agent — must today be handed a key whose authority is
described in the same vocabulary as one that can delete. This slice gives the
roadmap's named consumers a documented authority profile and makes the profile
enforced, and it resolves the `admin` scope that has been accepted at mint time
but enforced nowhere (#61).

---

## PDD — product definition

**User / actor**
A person or program provisioning a machine identity for a specific consumer:
an analytics/BI reader, a retrieval agent, or a program that writes. Also the
platform owner, who provisions keys for their own consumers.

**Job**
Mint a key whose authority is the *narrowest* one the consumer needs, chosen
from named profiles rather than hand-picked scopes, and be certain that the
profile is actually refused everywhere it should not reach.

**Why**
Scopes exist and are enforced, but nothing names the consumer profiles the
roadmap describes, and one advertised scope (`admin`) does nothing. A key whose
authority is undocumented, or documented but unenforced, is a robustness hole:
the owner cannot reason about what a leaked key can do.

**In scope**
- A `KEY_CLASSES` catalog naming three profiles, each mapped onto the real
  scopes, each with a documented authority profile:
  - `analytics` → `['read']` — workspace/job/activity/share metadata and RAG
    retrieval; no file or gallery bytes, no mutations.
  - `agent-read` → `['read', 'files']` — analytics plus file/gallery/media reads;
    no writes, no destructive actions.
  - `program-write` → `['read', 'write', 'files']` — agent-read plus upload,
    restore, job enqueue/run, document ingestion, and share creation; no delete,
    no archive, no revocation.
- `POST /api/keys` accepts an optional `keyClass` that expands to the class's
  scopes. `keyClass` and `scopes` are mutually exclusive; an unknown class is a
  `400`. Existing explicit-`scopes` and default behavior are unchanged.
- The three share routes (`POST`/`GET /api/workspaces/shares`,
  `DELETE /api/shares/:id`) gain the scope checks they were missing
  (`write`/`read`/`delete`), so a class is refused there like anywhere else.
- `admin` is **removed** as a scope: it is accepted at mint but enforced nowhere
  (every cross-tenant operation is already gated by `isPlatformOwner` plus the
  human confirmation gate, which an API key can never satisfy). No
  accepted-but-inert scope remains.

**Out of scope**
- A stored `key_class` column. No consumer reads a key's class after mint; the
  class is a mint-time preset over scopes, not a second authorization dimension.
- Any raw-SQL / direct-database surface for clients (#72).
- WebAuthn, new roles, a policy engine, or per-route sensitivity thresholds.
- Changing the dashboard key form. The classes are for machine consumers
  (API/MCP); the dashboard continues to mint its default profile.
- Expanding capability discovery with RAG routes or new actions.

**Reuse**
- The existing `requireScope`/`scopeDenied` enforcement and `OctoScope` type.
- `authorizeKeyMint` (a key may still only narrow its own authority).
- `SCOPE_PRESETS` (the dashboard's named presets), kept as-is.
- The MCP mint tool's existing shape (minus `admin`).

**Observable success**
- Minting `{ keyClass: 'analytics' }` yields a key whose `scopes` are `['read']`.
- That key reads activity/jobs but is refused `403` on `GET /api/files`
  (needs `files`), on upload (needs `write`), and on file delete (needs `delete`).
- `agent-read` reads files but is refused upload; `program-write` uploads but is
  refused file delete and share revocation.
- `keyClass` + `scopes` together → `400`; an unknown class → `400`.
- `scopes: ['admin']` → `400` (no longer an allowed scope).
- A principal may still mint explicit scopes exactly as before, and the
  workspace-scoped fence, revoke, and confirmation/MFA gates are unchanged.

---

## SDD — system and interface design

**Authority / canonical state**
Unchanged. `octo.api_keys.scopes` (a `TEXT[]`, no CHECK constraint) remains the
canonical record of a key's authority. The class is not persisted. No migration.

**Capabilities**
None new. `KEY_CLASSES` names existing scopes; three share routes gain one
`requireScope` each.

**API contract**
`POST /api/keys` gains one optional request field:

```
{ "name": "...", "workspaceId": "<uuid>"|null, "keyClass": "analytics"|"agent-read"|"program-write",
  "expiresInDays": <n>, "confirmSecret": "...", "mfaCode": "..." }
```

- `keyClass` present with `scopes` present → `400
  {"error":"BAD_REQUEST: keyClass and scopes are mutually exclusive"}`.
- `keyClass` not one of the three → `400 {"error":"BAD_REQUEST: keyClass must be
  one of: analytics, agent-read, program-write"}`.
- `keyClass` alone → `scopes` := the class's scopes (a copy), then the existing
  `authorizeKeyMint` narrowing still applies.
- Response is unchanged (`201 { apiKey: { ..., scopes }, rawSecret }`); the
  resolved scopes are already echoed.

The three share routes gain the standard refusal:
`403 {"error":"FORBIDDEN: Token is missing the required '<scope>' scope"}`.

**Provider / data flow**
No new flow. The class is resolved to a scope list in-process before the existing
mint path; nothing downstream changes.

**Client surfaces**
Server API only. `src/api/capabilities.ts` (catalog + scope model), the mint
route and share routes in `src/server/index.ts`, and the MCP mint tool's scope
enum (drops `admin`). No frontend change.

**Existing code reuse / replacement**
- Reuse: `requireScope`, `authorizeKeyMint`, `SCOPE_PRESETS`, the mint response.
- Change: `OctoScope` (drop `admin`), remove `ADMIN_CAPABILITIES`, add
  `KEY_CLASSES`; mint route (class expansion, drop `admin`); three share routes
  (add scope checks); the capabilities default list.
- Delete: the `admin` scope, `ADMIN_CAPABILITIES`, the platform-owner `admin`
  reservation block, and `admin` from the MCP enum.

**Failure boundary**
- In scope: class-X refusal outside its profile; malformed class requests; the
  `admin` removal; unchanged explicit-scope and default minting.
- Out of scope: existing keys that stored the string `admin` keep it inert (no
  route requires it), and are neither migrated nor revoked; that is intentional.
- Out of scope: the `workspaces.delete.any` platform-owner gate is unchanged and
  remains human-gated; this slice only stops advertising an inert scope for it.

---

## EVAL / TDD — completion oracle

**Public deterministic**
- `tests/e2e/typed-keys.spec.ts`: for each class, mint through a human session,
  assert the exact resolved scopes, and assert the class succeeds inside its
  profile and is refused `403` outside it (analytics: activity `200`, files
  `403`; agent-read: files `200`, upload `403`; program-write: upload `201`,
  file delete `403`, share revoke `403`). Plus `keyClass`+`scopes` → `400`,
  unknown class → `400`, `scopes:['admin']` → `400`, and revoke → `401`.

**End-to-end user flow**
- The same spec drives the real mint route and then calls each profile's routes
  with the minted key, proving the profile end to end (not just the catalog).

**Metamorphic / property**
- **Preset ≡ explicit scopes**: a key minted by class and a key minted with the
  class's explicit scope list, same principal and workspace, produce identical
  capability discovery and identical route decisions. This is the invariant that
  makes the catalog a preset and not a second authorization model.

**Hidden holdout**
- `tests/e2e/typed-keys-holdout.spec.ts`: an `analytics` key (minted over HTTP)
  driven through the **real MCP `download_file` tool** is refused, while an
  `agent-read` key retrieves the identical bytes. It changes the surface (MCP,
  not HTTP), the route (`/api/files/content`, not `/api/files`), and the pairing
  (analytics-refused / agent-read-allowed) — none of which the public spec uses.
  An implementation that only gated the routes the public spec happens to call
  would pass the public spec and fail this.

**Production smoke**
- Owner-only: mint one `analytics` key and one `program-write` key on a
  throwaway principal; confirm analytics is refused a file read and program-write
  can upload; revoke both.

---

## Lock

Owner accepted: 2026-10-05 — criteria recorded on issue #127. Locked at:
2026-10-05.

---

## Implementation reconciliation

- **Shape 1, not a class dimension.** The issue's own recommendation: extend the
  scope model and enforce it, adding a class dimension only if a concrete
  consumer needs one. No consumer reads a key's class after mint, so a stored
  class column would be state nothing uses — omitted.
- **`admin` removed, not enforced.** Enforcing it would require a route that an
  API key could reach and that no other gate already covers; no such route
  exists (cross-tenant deletion needs a human session + secret + slug + MFA).
  Keeping the scope would leave the advertised-but-inert gap #61 describes.
- **Share routes were the one real enforcement hole.** Create/list/revoke checked
  membership and role but no scope, so a `read`-only key could mint a share. The
  class profiles are only honest once those three routes are scope-gated.
