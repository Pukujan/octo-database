# Deep Security Audit — Issue Log

Date: 2026-10-05
Scope: whole-system audit of the Octo server (auth, authorization, tenant isolation, data plane, jobs, media, storage), not a single PR diff. Read-only analysis; no code changed.
Sources: `src/server/index.ts`, `src/server/db.ts`, `src/jobs/worker.ts`, `src/media/*`, `src/storage/*`, `src/api/*`, and migrations `slice1/2/4/6/14`.

Findings are filtered to high-confidence, exploitable issues. Excluded by policy: DoS/resource exhaustion, theoretical races, outdated-dependency CVEs, missing hardening, and client-side-only concerns. Verified non-findings are listed at the end.

---

## ISS-1 — HIGH — Raw principal UUID is accepted as a bearer session token — FIXED

**Category:** authentication / session management
**Locations:** `src/server/index.ts:360-398` (accept), `:958` (guest mint), `:905` (Google callback mint)

`authenticateRequest` treats any Bearer token matching `UUID_PATTERN` as a principal id and authenticates it directly, with no secret, expiry, or revocation check:

```ts
if (!UUID_PATTERN.test(token)) return null;
const rows = await queryService('SELECT ... FROM octo.principals WHERE id = $1', [token]);
if (rows.length === 0) return null;
bindRequestIdentity(pRow.id, null);
```

The id is handed to clients as the session token: guest login returns `sessionToken: principal.id` (`:958`) and the Google callback redirects to `${origin}/#token=${principal.id}` (`:905`). The principal's primary key *is* the credential.

**Exploit:** any disclosure of a principal UUID yields full, permanent impersonation. `Authorization: Bearer <uuid>` authenticates as that principal on every route — mint keys, upload, delete, enqueue jobs — with no expiry and no way to revoke short of deleting the principal row. Guest accounts are free and anonymous, so an attacker only needs one leaked UUID.

Disclosure channels are not hypothetical: `signMediaUrl` writes `principalId` into the media URL **query string** for principal-scoped tokens (`src/media/media-token.ts:78-79`), so every authenticated gallery `<img>`/`<video>` URL carries the viewer's principal UUID in cleartext — into browser history, `Referer` headers on any outbound navigation, and reverse-proxy/CDN access logs by default. ISS-2 and ISS-3 add two API-level channels (share `createdBy`, and the thumbnail `Location` header).

**Fix:** stop using the primary key as a bearer secret. Issue a signed, expiring, revocable session token (HMAC over `{principalId, exp}` with a server secret, or a `sessions` table) and validate that on the session path; keep API keys for machine callers. Separately, stop emitting the principal UUID as a visible media-URL parameter — sign an opaque nonce or keep the id inside the HMAC payload only.

---

## ISS-2 — HIGH — Share metadata responses leak the creator's principal UUID — FIXED

**Category:** data exposure / broken authorization boundary
**Locations:** `src/server/db.ts:686-719` (`dbInsertShare` RETURNING), `:775-787` (`dbListShares`); `src/server/index.ts:2246-2250` (create response), `:2285-2286` (list response)

Both share routes return the full `DbShareRow`, which includes `created_by AS "createdBy"` — a principal UUID:

```ts
// POST /api/workspaces/shares
sendJson(res, 201, { share: { ...share, tokenHash: undefined }, shareUrl, rawToken });
// GET /api/workspaces/shares
sendJson(res, 200, await dbListShares(workspaceId));
```

`createdBy` is not needed by any client. Combined with ISS-1, this is a direct privilege-escalation primitive: the leaked UUID is a working bearer token.

**Exploit:** a member/admin lists a workspace's shares (`GET /api/workspaces/shares?workspaceId=...`) and reads the creator's principal UUID, then replays it as `Authorization: Bearer` to impersonate that creator — who may be the workspace owner or the platform owner.

**Fix:** strip `createdBy` from all client-facing share payloads. Map rows to an explicit response shape (`id, tokenPrefix, permission, validFrom, validUntil, revokedAt, accessCount, lastAccessedAt`) rather than spreading the DB row.

---

## ISS-3 — MEDIUM-HIGH — Thumbnail fallback upgrades a share-scoped request to an uncapped principal-scoped token — FIXED

**Category:** authorization / credential escalation
**Locations:** `src/server/index.ts:1687-1702` (the 302), `:411-460` (`authorizeMediaRequest`), `src/media/media-token.ts:57-85`

The thumbnail route serves both bearer callers and share-media-token callers. When `ensureThumbnail` returns `null` (non-image, or original missing/corrupt), it redirects to the full object using a **principal**-scoped media URL:

```ts
res.writeHead(302, { Location: signMediaUrl('/api/files/content', {
  kind: 'principal', fileId, workspaceId, principalId,   // principalId = share.createdBy
}) });
```

Two defects: (a) an anonymous share-token holder is handed a principal-scoped token, which is a broader credential class than the share they presented; (b) no `notAfter` is passed, so `signMediaUrl` uses the default 3600s TTL instead of capping at `share.validUntil` as the public-gallery route does (`:2371-2372`).

**Exploit:** a logged-out holder of a valid share link requests the share-signed thumbnail URL for any non-image (or archived/corrupt) file in the shared gallery. The server 302s them to a URL whose `Location` embeds the creator's `principalId` and a signed token valid for an hour — outliving a short-lived share. The `Location` header also discloses the creator UUID, which feeds ISS-1.

**Fix:** when the request was authorized by a share token, the fallback must sign a **share**-scoped URL (`kind: 'share'`, with the share id) and pass `share.validUntil` as `notAfter`. Never widen a share authorization into a principal one.

---

## ISS-4 — HIGH — `POST /api/jobs` trusts the caller's `payload`; the thumbnail handler reads an attacker-chosen object key — FIXED

**Category:** broken tenant authorization / trusted caller with untrusted input
**Locations:** `src/jobs/worker.ts:54-73` (`handleThumbnailJob`), `src/media/thumbnail-service.ts:32-65` (`ensureThumbnail`), `src/server/index.ts:2509-2565` (enqueue), `:1656-1713` (thumbnail read-back)

`POST /api/jobs` requires `write` scope + operator membership in the *enqueuing* workspace and validates nothing about `payload`; it only blocks `archive_file`/`restore_file` (`:2528-2531`), so `jobType: "thumbnail"` is allowed with an arbitrary body. `handleThumbnailJob` then reads `fileId`, `storageKey`, and `mimeType` straight from `job.payload` and calls `ensureThumbnail(store, fileId, storageKey, mimeType)`, which does `store.get(storageKey)` on the **single shared bucket** and writes the derivative to the flat, non-workspace-partitioned key `derived/<fileId>/thumb.webp`.

**Exploit A — cross-tenant object read.** An operator in workspace A uploads a small image (own `fileId`), then enqueues a `thumbnail` job with `payload.storageKey` pointing at workspace B's object and `payload.fileId` set to A's file id. The worker reads B's bytes and writes `derived/<A_file>/thumb.webp`; `GET /api/files/thumbnail?workspaceId=<A_ws>&fileId=<A_file>` passes `dbGetFile` (own workspace) and serves the cached derivative — B's image content. B's key is reconstructible: the public share route (`:2336-2398`) returns file ids/names and the signed URLs at `:2371-2372` carry B's `workspaceId`, and the key format is deterministic (`workspaces/<wsId>/<fileId>/<sanitized name>`, `:1496`).

**Exploit B — cross-tenant cache poisoning.** Enqueue the same job with `fileId` = a victim's file id and an attacker-chosen `storageKey`. `ensureThumbnail` writes `derived/<victimFileId>/thumb.webp`, so the victim's own thumbnail request then serves the attacker's image. Per `thumbnail-service.ts:43-46` it only writes when no derivative exists yet, so this poisons not-yet-thumbnailed files rather than overwriting an existing cache — still a full integrity break for any file the victim has not yet viewed. This variant needs no key reconstruction — only a victim file id — but the overwritten key must be one the victim's workspace will actually request, i.e. a real file id from that workspace. A victim file id is obtainable from the public gallery route when the victim has an active share (`:2336-2398`); the platform-wide id space is otherwise not enumerable.

Both variants therefore share one precondition — a victim file id (and, for the read path, the derived `storageKey`) leaked by an active share link or another id disclosure. Exploit A additionally requires the attacker to reconstruct the deterministic key. The root defect — the worker trusting `payload` instead of resolving the file through `job.workspaceId` — is unconditional.

Reachability needs no victim action: the server's minute tick calls `drainQueueOnce(undefined, 25)` (`:567`), which claims jobs globally.

**Fix:** do not trust payload identifiers. In `handleThumbnailJob`, ignore `payload.storageKey` and load the file via a workspace-scoped read — `dbGetFile(job.workspaceId, fileId)` — deriving `storageKey`/`mimeType` from that row and failing with `INVALID_PAYLOAD` when absent. Allowlist `jobType` at `POST /api/jobs`, and make derivative keys workspace-scoped (`derived/<workspaceId>/<fileId>/...`). Note the archive/restore handlers are already correct (`handleArchiveJob` resolves via `dbGetArchiveRecord`, which filters `id = $1 AND workspace_id = $2`), so the hole is specific to the unblocked `thumbnail` type.

---

## ISS-5 — MEDIUM — MFA recovery codes can be consumed more than once — FIXED

**Category:** authentication / MFA bypass (non-atomic state update)
**Locations:** `src/server/index.ts:667-687` (`verifyMfaCode`), `src/server/db.ts:1484-1489` (`dbSetMfaRecoveryCodes`)

`verifyMfaCode` reads the recovery-code hash list, checks membership, then writes back the filtered list:

```ts
if (mfa.recoveryCodeHashes.includes(hash)) {
  await dbSetMfaRecoveryCodes(principalId, mfa.recoveryCodeHashes.filter((c) => c !== hash));
  return true;
}
```

This is a read-modify-write with no row lock or compare-and-set. Two concurrent step-up requests (e.g. two parallel workspace deletions) both read the same list, both find the code, both return true; the last write wins and the code survives. A single recovery code can therefore authorize multiple destructive operations, and the "one-time" property it is documented to have is not enforced.

**Exploit:** an attacker holding one recovery code fires the same `confirmGate`-protected request concurrently (e.g. `curl ... & curl ... &`) to perform more than one owner-gated action — delete a workspace, mint a key — from a code the owner believes is spent.

**Fix:** consume the code atomically in one statement, e.g. `UPDATE octo.principals SET mfa_recovery_code_hashes = array_remove(mfa_recovery_code_hashes, $1) WHERE id = $2 AND $1 = ANY(mfa_recovery_code_hashes) RETURNING id`, and treat zero rows as failure. Do the same inside a transaction for the TOTP fallback path.

---

## ISS-6 — MEDIUM — Platform owner is a hardcoded personal email in a public repository — FIXED

**Category:** privilege escalation / hardcoded privileged identity
**Location:** `src/server/db.ts:246-249`

```ts
const isOwner =
  email.toLowerCase() === 'pujan3645@gmail.com' ||
  (Boolean(process.env['PLATFORM_OWNER_EMAIL']) &&
    email.toLowerCase() === process.env['PLATFORM_OWNER_EMAIL']!.toLowerCase());
```

Platform-owner authority (`is_platform_owner = true` → all workspaces, role `owner`) is granted by matching a literal address baked into source. The email originates from the Google profile (so it is not attacker-settable in the normal flow), which caps exploitability — but the design has two real problems: it publishes a privileged identity in a public repo, and it makes ownership depend on control of one specific Gmail account with no rotation path (`PLATFORM_OWNER_EMAIL` already exists as the intended mechanism, making the literal redundant). Note also `ON CONFLICT ... is_platform_owner = octo.principals.is_platform_owner OR EXCLUDED.is_platform_owner` (`:257`) means the flag can never be cleared by a later login.

**Exploit:** anyone who controls or compromises `pujan3645@gmail.com` — or who can complete the Google flow for it — becomes platform owner, with cross-tenant read/delete authority over every workspace. The literal also hands an attacker a named target.

**Fix:** delete the hardcoded literal and rely solely on `PLATFORM_OWNER_EMAIL`. Confirm the `OR` on `is_platform_owner` is intentional; if not, replace with `EXCLUDED.is_platform_owner`.

---

## ISS-7 — LOW — Dead `verifyApiKey` contains an unscoped key lookup — FIXED

**Category:** latent authorization bypass / dead code
**Location:** `src/api/keys.ts:176-252`

`verifyApiKey` is not on any live path — the server authenticates API keys through `dbVerifyApiKey` (`src/server/db.ts:614-645`) — but it retains a fallback that selects an API-key row by hash without workspace scoping or expiry filtering:

```ts
const { data } = await supabase.from('api_keys').select('*').eq('key_hash', keyHash);
```

If this function is ever wired back in (e.g. someone "simplifies" the auth path), it bypasses the RLS fence and the expiry check that `dbVerifyApiKey` enforces.

**Fix:** delete the function, or make it delegate to `dbVerifyApiKey` so there is exactly one key-verification path.

---

## Verified non-findings

Checked and cleared, so they are not re-litigated:

- **SQL injection:** none. Every caller-derived value is a `$n` bind param. The only dynamic SQL fragments are hardcoded column maps (`JOB_COLUMNS`, the archive-state column map), literal `IN` lists, and pgvector literals (`[...]::vector`) built from trusted embedding output. Migrations use `format('%I', ...)` over a hardcoded table array.
- **RLS fence coverage:** complete. The slice14 RESTRICTIVE `tenant_scope_fence` covers all 20 tenant tables (including `chunks`/`embeddings` DELETE and `api_keys` UPDATE); `workspaces` and `workspace_memberships` are fenced explicitly. `octo.principals` is correctly unfenced (account-scoped) with own-row-only policies.
- **Media token integrity:** HMAC-SHA256 over `kind:fileId:workspaceId:principalId|shareId:exp`, compared with `timingSafeEqual`; invalid/expired tokens fail closed; share-scoped URLs re-check the share is still active.
- **Share gallery XSS:** `main.ts` escapes all interpolated values via `esc()` (`& < > " '`); no unsafe `innerHTML` with unescaped data.
- **Upload path traversal:** storage keys are server-constructed; the local store rejects paths outside its root; static serving guards `startsWith(normalizedDist)`.
- **Archive lifecycle ordering:** copy → verify size+hash → persist state → delete source; restore verifies before trusting. No verify-before-delete inversion, and both are workspace-scoped.
- **API key verification:** `dbVerifyApiKey` fails closed and filters `expires_at`; one-key rule enforced for account-wide keys.
- **Job/activity listings:** `JOB_COLUMNS` and `dbListActivity` omit `created_by`/`actor_principal_id`, so they do not repeat the ISS-2 leak.
- **Host-header trust in `getPublicOrigin` (`index.ts:708-723`):** the function builds the OAuth redirect origin from `PUBLIC_BASE_URL` (preferred) or `x-forwarded-host`/`host`, and the Google callback redirects to `${origin}/#token=${principal.id}` (`:905`). A Host-injection-driven open redirect would leak the session token — but triggering it requires the victim's browser to present an attacker-controlled Host on a top-level navigation to the real server, which the fixed OAuth `redirect_uri` prevents in the normal flow. Recorded as a hardening item (set `PUBLIC_BASE_URL` in every deployment), not reported as a finding.
- **CORS `Access-Control-Allow-Origin: *` with `Authorization` allowed (`index.ts:733-740`):** not itself a vulnerability (the server still requires a token, and `*` cannot be combined with ambient credentials), but it lets a leaked UUID (ISS-1) be replayed from any web origin's JavaScript. It compounds ISS-1/ISS-2 rather than standing alone.
- **`GET /api/public/shares/:token` ignores `share.permission` (`index.ts:2336-2398`):** an `upload`-permission link receives the same read listing and signed content URLs as a `read` link. A permission-model inconsistency, not cross-tenant access (the token still authorizes only that one workspace) — flagged for the owner, not counted as a finding.
- **`GET /health` is anonymous and returns DB version + R2 bucket name:** information disclosure useful for targeting, no cross-tenant reach — hardening only.
- **`GET /api/keys` and `GET /api/capabilities` omit `requireScope`:** neither exposes another tenant's data (`dbListApiKeys` filters `principal_id = caller` under the `api_keys_select_own` policy), so no finding.

---

## Priority

| ID | Severity | One-line |
|----|----------|----------|
| ISS-1 | HIGH | Principal UUID accepted as a non-expiring, non-revocable bearer token |
| ISS-4 | HIGH | Job payload trusted; thumbnail handler reads an arbitrary object key (cross-tenant read + cache poisoning) |
| ISS-2 | HIGH | Share create/list responses leak the creator's principal UUID |
| ISS-3 | MED-HIGH | Anonymous share request upgraded to an uncapped principal media token; creator UUID in `Location` |
| ISS-5 | MEDIUM | MFA recovery code consumable more than once (non-atomic read-modify-write) |
| ISS-6 | MEDIUM | Platform owner hardcoded as a personal email in public source |
| ISS-7 | LOW | Dead `verifyApiKey` with an unscoped lookup |

ISS-1 and ISS-2 form a two-step account-takeover chain and should be fixed together: the UUID leak is only dangerous because the UUID is a credential, and the UUID is a credential only because of ISS-1.

---

## Formal-methods re-evaluation (does the audit change the earlier recommendation?)

Earlier guidance: stay on PDD/SDD/TDD, and at most build a lightweight Alloy/SMT model of the tenant-isolation invariant; revisit TLA+ only if Octo grows a distributed control plane. The audit refines that answer rather than reversing it.

1. **TLA+ / theorem provers: still not warranted.** These tools target protocol and concurrency correctness. The audit found exactly one genuine concurrency defect (ISS-5) and zero distributed-protocol bugs. Octo is not a distributed protocol; nothing in the evidence changes Brooker's applicability condition (stable, large-scale, distributed, low-level). seL4-class rigor remains disproportionate to the codebase.

2. **The RLS fence — the one property previously proposed for modeling — is demonstrably sound.** Two independent passes found complete coverage across all tenant tables and no SQL injection. "Already correct" is not "will stay correct," so the invariant is still worth protecting — but the proportionate form is a cheap **drift check**, not a model: a conformance test asserting "every table with a `workspace_id` is in the fence" and "every app-pool call site binds identity first."

3. **Redirect the lightweight formal effort from a scope×role table to *promotion-forbidding invariants*.** ISS-1..ISS-4 are not scope mistakes; they are **identity-promotion** mistakes — share→principal (ISS-3), payload→object (ISS-4), id→credential (ISS-1). The high-yield properties are of the form: *no unauthenticated or lower-privilege input may yield an `AuthContext` (or a resolved object key) with more authority than its provenance.* The PDD already asserts "scopes are enforced server-side on every route"; ISS-3 and ISS-4 are concrete violations of that stated invariant. Property/metamorphic tests over the guard matrix catch "a route forgot to call one" as effectively as Cedar or an SMT guard lattice would, without the abstraction the project's anti-overengineering contract forbids.

4. **ISS-5 (MFA race):** a model checker would catch it, but a compare-and-set fix plus a concurrent double-spend test is far cheaper than a TLA+ spec. One read-modify-write is not a state space worth modeling.

**Caveat:** the worst chain (ISS-1) is a credential-*design* flaw — "the primary key is a bearer secret." No model or property test prevents that; it is a design-review catch. The process gap this audit exposes is a missing authorization-invariant review, not a missing formal tool.

**Net recommendation:** keep PDD/SDD/TDD; add (a) a fence drift-check test and (b) promotion-forbidding property tests over the guard matrix; leave TLA+ on the shelf until Octo grows an actual distributed control plane.
