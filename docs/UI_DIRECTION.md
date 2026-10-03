# Octo UI direction

Owner correction recorded on [issue #74](https://github.com/Pukujan/octo-database/issues/74#issuecomment-5965479948), 2026-10-03.

## Product surface

Octo is a workspace portal for people and agents working with durable files and workspace activity. Its frontend focuses on the jobs that need an Octo-specific surface:

- workspace overview and selection;
- file browsing, upload, download, archive, restore, and removal;
- image and video gallery;
- background job review and retry;
- workspace API keys and share links.

Provider and database administration stays in the provider's own console. Show real workspace data and available actions; do not invent infrastructure status or analytics.

## Visual direction

- Start fresh. The previous dashboard is only a record of existing behavior, not a layout, style, or component template to preserve.
- Dark appearance is the default. Keep an alternate light appearance available.
- Use clear hierarchy, generous spacing, one focused job per view, and imagery only where it helps browse actual workspace media.
- Use the existing React/MUI runtime for this delivery, with application views consuming semantic design tokens through a small adapter. Keep the view composition and tokens independent of that adapter so the component foundation can be replaced without rewriting product behavior.
- Keep color, radius, typography, borders, and surface values in src/ui/theme.ts; page CSS should consume the corresponding --octo-* variables.
- The interface must work at desktop and mobile widths, with visible keyboard focus.

## Workspace views

| View | Primary job |
| --- | --- |
| Overview | Understand the current workspace, see recently added files and activity, and reach the next useful action. |
| Files | Find, upload, download, archive, restore, or remove a file. |
| Gallery | Browse actual workspace images and video in a visual layout. |
| Operations | Find failed jobs, understand the failure, retry, and review recent activity. |
| Access | Manage workspace API keys, share links, and workspace details. |

## Behavior boundary

Keep the existing API and storage callbacks as the data/action boundary. A visual rebuild may replace the previous page structure and decorative assets, but it must not change the server's authorization or provider behavior. Preserve the public read-only share route and its standalone viewer.

## Research workflow

Use design tooling when it is available, especially a code-native visual editor or editable design canvas. If it is unavailable, iterate directly on the real React code and browser preview. Use the same workspace data and actions across design iterations; owner taste decides visual quality.

For the owner-requested Dyad dashboard experiment, use [the Dyad dashboard brief](frontend/DYAD_DASHBOARD_BRIEF.md). It separates current API behavior from proposed quota and observability contracts so a prototype cannot mistake sample data for production capability.
