# OCTO-0300 Workspace image and video gallery

<!-- continuity:task {"acceptance":["Album and folder media querying with MIME type classification","Derived thumbnail generation and caching without downloading full originals in grid view","Full-screen responsive image lightbox modal","In-browser native HTML5 video player for supported video formats","Fail-closed cross-workspace media authorization preventing unauthorized access","All gates pass across Python, TypeScript, and JSON contracts"],"depends_on":["OCTO-0200"],"goal":"Build private workspace image and video gallery with grid thumbnails, full-screen image view, and responsive media playback","id":"OCTO-0300","issue_url":"https://github.com/Pukujan/octo-database/issues/5","next_action":"Implement album querying, thumbnail endpoint, and MUI gallery viewer component in task/OCTO-0300-gallery.","owner":"Pukujan; main agent coordinates implementation","priority":"P1","protocol_version":"0.1.0-draft","schema":"project-continuity.task.v1","status":"active","why":"Enable family and personal users to browse media visually without exposing raw infrastructure or admin controls per Slice 3 / Issue #5."} -->

- Status: active
- Priority: P1
- Branch: `task/OCTO-0300-gallery`
- GitHub issue: https://github.com/Pukujan/octo-database/issues/5

## Goal

Build the first polished user-facing application: a private image/video gallery over the existing workspace/file APIs. Family/personal users can browse albums visually, load thumbnails quickly, open full images, and play browser-supported videos without seeing infrastructure or admin controls.

## Prepared on this branch

- Task definition and acceptance criteria aligned with GitHub Issue #5 (Slice 3).
- Media query and thumbnail derivation specifications.

## Checkpoint log

Task initialized following successful merge of Slice 5 (PR #24: Google Drive archival, R2 guest storage verification, and CGM hero asset).
Next step is to create the gallery UI component, media query routes, and thumbnail generator.

### Slice 3 implementation (PR #27)

Implemented and verified locally against a live PostgreSQL 16 instance and the browser:

- Media classifier for image and browser-playable video MIME types (`src/media/classifier.ts`).
- Idempotent thumbnail derivatives at the stable key `derived/{file_id}/thumb.webp`; a retry reuses the
  existing object instead of writing a duplicate (`src/media/thumbnail-service.ts`).
- Backend-agnostic `ObjectStore` with R2 and local implementations (`src/storage/object-store.ts`).
- Signed short-lived media URLs, because `img`/`video` elements cannot send `Authorization` headers;
  the signature is scoped to one file + workspace + principal and membership is re-checked on every use.
- Routes: `GET /api/gallery`, `GET /api/files/thumbnail`, `GET /api/files/content`.
- React MUI gallery grid with modal lightbox and image/video playback (`src/ui/Gallery.tsx`).

Verified evidence: grid loads a 400x300 WebP derivative while the lightbox loads the 1000x700 original,
with zero failed requests; exactly one derivative object exists on disk after repeated requests;
unsigned and forged media requests return 401; an unauthorized principal receives FORBIDDEN.

Defects found and fixed during this work: base64 upload payloads were stored as text rather than decoded
bytes (corrupting every uploaded image); the local download fallback returned its own endpoint; the
implicit local storage fallback was replaced with an explicit `OCTO_STORAGE_BACKEND=local` opt-in so
production still fails closed without R2; the Google sign-in button linked to a nonexistent route.
