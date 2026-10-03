# Runtime secret contract

Owning issue: #16.

Octo provider credentials are runtime inputs. They are never GitHub planning data, browser configuration, agent-readable capability data, or ordinary log fields.

## Secret names

Google Drive:
- `GOOGLE_DRIVE_CLIENT_ID` — confidential application identifier where the provider treats it as sensitive.
- `GOOGLE_DRIVE_CLIENT_SECRET` — secret.
- `GOOGLE_DRIVE_REFRESH_TOKEN` — secret created by the owner-authorized OAuth flow; never expose it to browsers or agents.

Cloudflare R2:
- `R2_ACCOUNT_ID` — runtime configuration; treat as non-public operational metadata.
- `R2_ACCESS_KEY_ID` — secret-bearing credential identifier.
- `R2_SECRET_ACCESS_KEY` — secret.
- `R2_BUCKET` — non-secret runtime configuration.
- `R2_ENDPOINT` — non-secret runtime configuration.

No value belongs in this document, an issue, PR body, commit message, transcript, screenshot, or test fixture.

## Runtime boundary

Production/development runtime secret storage injects credentials into the server/worker process. Browser code and agent principals call Octo APIs and receive scoped logical capabilities only.

Google Drive authorization uses a human OAuth flow appropriate to the app-controlled archive area. Do not substitute a service account when the intended personal Drive ownership/quota semantics require the human account.

R2 credentials must be restricted to the intended account/bucket and operations as narrowly as Cloudflare permits. Do not use an account-wide master credential for convenience.

## Installation transaction

1. Run the repository leak check before receiving any real credential.
2. Owner creates/reviews least-privilege provider credentials outside GitHub.
3. Install values only in the selected runtime secret mechanism.
4. Start the server/worker with the required secret names present.
5. Perform one bounded provider test operation per provider.
6. Record only redacted receipts: operation class, provider, timestamp, result, resource logical ID, and non-secret scope summary.
7. Run browser/network/log/agent leak checks.
8. Run the repository leak check again, including validator-supplied non-secret fingerprint markers.
9. Revoke/rotate a temporary credential and prove failure is redacted and predictable.

## Fail-closed rules

Missing or invalid credentials disable the affected provider operation; they do not fall back to embedded defaults. Errors must not echo authorization headers, secret values, refresh tokens, access keys, or full provider responses containing them.

If a real secret reaches Git history or GitHub prose, stop provider work, revoke/rotate it immediately, preserve only redacted incident evidence, and remediate history according to repository policy.
