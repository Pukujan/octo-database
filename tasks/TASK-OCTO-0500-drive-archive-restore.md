# OCTO-0500 R2-to-Google-Drive archive lifecycle and restore

<!-- continuity:task {"acceptance":["Google Drive OAuth 2.0 refresh token authorization against drive.file scope","Cloudflare R2 active storage integration with dedicated octo bucket","3 guest workspaces verified end-to-end archiving active R2 files to Google Drive","Restoration of archived files from Google Drive back to R2 active tier with byte-for-byte fidelity","Cross-workspace storage path isolation across all 3 guest accounts","All gates pass across Python, TypeScript, and JSON contracts"],"depends_on":["OCTO-0200"],"goal":"Connect Google Drive OAuth 2.0 and Cloudflare R2 active storage to provide verified file archival, restore, and cross-workspace isolation across guest and owner workspaces","id":"OCTO-0500","issue_url":"https://github.com/Pukujan/octo-database/issues/7","next_action":"Push PR for Slice 5, verify CI gates on GitHub-hosted runner, and merge via auto-merge.","owner":"Pukujan; main agent coordinates implementation","priority":"P1","protocol_version":"0.1.0-draft","schema":"project-continuity.task.v1","status":"active","why":"Enable cold archiving of active R2 workspace files into Google Drive (5TB personal storage tier) and byte-perfect restoration per Slice 5 and Issue #7."} -->

- Status: active
- Priority: P1
- Branch: `task/OCTO-0500-drive-archive-restore`
- GitHub issue: https://github.com/Pukujan/octo-database/issues/7

## Goal

Connect Google Drive OAuth 2.0 and Cloudflare R2 active storage to provide verified file archival, restore, and cross-workspace isolation across guest and owner workspaces.

## Prepared on this branch

- Google Drive OAuth 2.0 authorization helper `scripts/authorize_google_drive.py` obtaining persistent refresh token with `drive.file` scope
- Storage credential verification suite `scripts/verify_storage_credentials.py` testing live R2 buckets and 5TB personal Google Drive quota
- End-to-end multi-workspace guest storage verification suite `scripts/verify_live_guest_storage.py` running active R2 upload, SHA-256 verification, archival to Google Drive, active R2 deletion, restore from Google Drive to R2 with exact byte match, and cross-workspace isolation
- Cross-platform Windows JSON contract path normalizer in `scripts/check_json.py`
- CGM narrative PNG hero banner `docs/assets/octo-hero-banner.png` registered in `.content-system/asset-manifest.json` and `.content-system/visual-style.json`
- Human-facing `README.md` reflecting complete system architecture, storage tiers, and verification runbooks

## Checkpoint log

Verified live Cloudflare R2 access across 8 buckets including dedicated `octo` bucket.
Verified live Google Drive v3 API connection under personal account with 5.00 TB total quota.
Verified 3 separate guest accounts performing end-to-end storage lifecycle: active R2 upload, SHA-256 hash validation, archival to Google Drive, R2 active deletion, and byte-perfect restoration from Google Drive back to R2.
Verified cross-workspace storage path isolation preventing guest accounts from reading or overwriting other workspaces' files.
All repository gates pass cleanly: Python unittests, Vitest tests, TypeScript type checking, Ruff lint/format, Mypy, and 18 JSON contracts.
