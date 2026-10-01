# Octo

Octo is a self-hosted control plane for people who want **one place to reach their workspaces, files, applications, and agents** without rebuilding login and storage plumbing for every project.

## Why this exists

Personal files, family media, work projects, research systems, and AI agents often end up scattered across local disks and unrelated services. Octo is intended to give them one durable identity and workspace boundary while keeping the underlying infrastructure replaceable.

## What the first usable version should do

The first end-to-end path is deliberately small:

1. Sign in with Google.
2. Open an authorized workspace.
3. Upload a file into private active storage.
4. Browse images and videos in a gallery.
5. Share one album or folder with a scoped read-only link.
6. Archive inactive files to Google Drive and restore them when needed.
7. See background jobs and recent activity.

**The user should not need to know whether a file currently lives in R2 or Drive.** The platform API and metadata catalog resolve that detail.

## How it grows

The stable core is identity, workspaces, authorization, file metadata, jobs, and one platform API. Optional capabilities can be enabled only for projects that need them: semantic retrieval, epistemic/bitemporal research data, graph projections, analytical Parquet datasets, and later distributed workers.

The live program plan is tracked in [GitHub issue #1](https://github.com/Pukujan/octo-database/issues/1). Individual slices are separate issues so advanced capabilities do not block a useful first release.

## Boundaries

- Octo is not trying to recreate AWS or Azure.
- Version one is not a public multi-tenant SaaS.
- Large file bytes belong in object/archive storage, not the operational database by default.
- Browsers and agents must not receive master database, R2, or Google Drive credentials.
- Secrets never belong in Git history or issue logs.

## Current status

Repository governance and planning are being initialized under [issue #2](https://github.com/Pukujan/octo-database/issues/2). Product implementation starts with the login/workspace slice after that bootstrap is accepted.
