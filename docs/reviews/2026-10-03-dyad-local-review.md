# Dyad v2 (`dyad-v2` branch): code review of the local Dyad session

Reviewed 2026-10-03 (EDT). This is a read-only review of the Dyad-built v2 frontend, commits ea3fadc → 57aa953 (now on branch `dyad-v2`), plus the Dyad session data for that app (chat transcript, app settings, main.log).
Versions installed: @tanstack/query-core 5.104.1, vite 8.3.1, react 19.3.0, tailwindcss 4.3.3.

Commits: v1 UI = `e432152` ("Redesign Octo workspace UI with dark theme" #85, MUI + hand-written CSS, made before Dyad).
`3c34a4c` added the Dyad tagger. `ea3fadc` = v2 (04:20 EDT). `362c4a4` = login and the bug (04:25). `501f2a4` and `57aa953` = failed fixes (04:48, 04:52).

> The fix proposed in Task 1 is implemented by the PR that adds this document. See "Verification" at the end.

---

## TASK 1: the error-log storm

### Verdict: CONFIRMED, with 4 corrections
The core mechanism holds: an AuthGate/LoginPage mount/unmount render loop. Corrections:
1. **Vite 8.3.1 returns 502, not 500.** See `node_modules/vite/dist/node/chunks/node.js:19744-19751`: `configure()` runs first, then Vite attaches its own `proxy.on("error")`, which does `logger.error("http proxy error: …")` and `res.writeHead(502)`. `fetch` resolves, so `offlineUntil` never trips. The custom listener is only a second listener, so it can't suppress Vite's log.
2. **The proposed `refetchOnMount:false` would NOT stop the loop.** In query-core 5.104.1, `queryObserver.js:431-436`:
   `shouldFetchOnMount = shouldLoadOnMount(...) || (data !== undefined && shouldFetchOn(..., refetchOnMount))`.
   `shouldLoadOnMount` = `enabled !== false && data === undefined && !(status === "error" && retryOnMount === false)`.
   With no data, `refetchOnMount` is never consulted. The option that works is **`retryOnMount: false`**.
3. **The loop doesn't need the backend to be down.** Any `/api/me` error with no cached data triggers it. That includes a **401 when logged out with the backend running** (live.ts:77-84 throws on 401). Requests would then reach the real server at ~150/s. With the backend down, `/health` loops too. With it up, `/health` succeeds and gets cached (staleTime 60s), so only `/api/me` loops.
4. **Back-off on 5xx is defense-in-depth only, not a fix.** If the breaker trips, `request()` throws before `fetch` (live.ts:59-61). The query errors within microtasks and the mount/unmount loop keeps spinning with no network, so the logs go quiet but the tab burns CPU. The loop has to be broken in React/Query.

### Evidence (actual code at HEAD 57aa953)
- `src/v2/components/auth/auth-gate.tsx:35-41`: `const { isDemo, isAuthenticated, isLoading } = useAuth(); … if (isLoading) return <Splash />; return <LoginPage />;`
- `src/v2/pages/login.tsx:14`: `useAuth()` (which calls `useMe()`). `:16`: `useHealth()`. Each LoginPage mount adds new observers on the errored `["me"]` and `["health"]` queries.
- `src/v2/auth/use-auth.ts:30` `const me = useMe();`. `:84` `isLoading: me.isLoading`.
- `src/v2/data/hooks.ts:20-28` useMe (`retry:false, staleTime:30_000`, no `retryOnMount`/`enabled`). `:94-104` useHealth (same).
- `node_modules/@tanstack/query-core/build/modern/query.js:486-496` `fetchState()`: with `data === undefined` it sets `status:"pending", error:null`. So every refetch of an errored, never-succeeded query flips `isLoading` (pending && fetching) back to true.
- `src/v2/main.tsx:16-27`: defaults `staleTime 30s, retry 0, refetchOnWindowFocus false, refetchOnReconnect false`. None of these matter here: the trigger is new-observer mount with no data (`staleTime` is ignored when data is undefined).
- `src/v2/main.tsx:33`: `<React.StrictMode>`. In dev this adds one extra mount/unmount at startup, and in-flight fetches are deduped. It is **not** a loop source by itself.
- `src/v2/data/live.ts:69-75`: breaker is set only in `catch` (network throw). `:86-97`: a 502 becomes `OctoApiError(502)` with no back-off.
- `vite.config.ts:14-26, 44, 49`: `quietExpectedRefusal` listener. It can't silence Vite's built-in handler.
- `src/v2/data/provider.tsx:16-20, 27`: persisted `localStorage["octo.dataMode"]==="live"` selects LiveOctoApi. That puts the preview on the gated path.

Loop: LoginPage mounts → its new `["me"]` observer `shouldLoadOnMount` → fetch → `status: pending` → AuthGate sees `isLoading` → `<Splash/>` (LoginPage unmounts) → 502/401 → `status: error` → AuthGate renders `<LoginPage/>` → repeat. Each cycle sends 1× `/api/me` + 1× `/health`. The snapshot logs show about 140–160 proxy errors/s (2,306 `/api/me` + 1,725 `/health` in ~26 s of storm).

Other things I checked that are not loop sources: there's no websocket/live reconnect code in v2. `sidebar.tsx` uses `useHealth()`, but only inside the authed shell. `ActiveWorkspaceProvider` (workspace-context.tsx:45-48) has a guarded setState effect, so it's fine. `refetchInterval` on `/health` was already removed in 501f2a4. UserMenu calls `useMe` + `useAuth`, which is fine because it only renders when authenticated (data present).

### Why Dyad's fixes failed (from git diffs plus the Dyad session timeline)
- 362c4a4 shipped without a type check or runtime check. Build mode in Dyad 1.17 has no `run_type_checks`/`read_logs`.
- 501f2a4 changed `retry:0`, `staleTime`, removed `refetchInterval`, added the `offlineUntil` breaker and the `quietExpectedRefusal` proxy listener. All of these target retries or log noise. None stops the mount-triggered refetch. The breaker never fires on a 502, and the listener can't remove Vite's logger. Fresh logs still showed the storm, but the model declared it fixed.
- Turn 32: 19 KB of thinking with no tool calls (cancelled). It did identify the 500/502 → no-throw issue, but it never got to the render loop.
- Chat 7 / 57aa953 (auto → free Nemotron): only extended the listener to cover AggregateError. Same dead end, and it claimed success. The storm resumed at 04:55:26.
- Dyad app row: `theme_id = NULL`, `needs_app_blueprint = 0` (Dyad app database). Dyad log: "Theme for app 1: none, prompt length: 0 chars".

### Minimal fix (not applied)
```diff
--- src/v2/data/hooks.ts
+import { getToken } from "@v2/auth/session";
 export function useMe() {
   const { api } = useOctoData();
   return useQuery({
     queryKey: queryKeys.me,
-    queryFn: () => api.getMe(),
+    // No token in live mode = signed out: resolve null without a request.
+    queryFn: () => (api.mode === "live" && !getToken() ? Promise.resolve(null) : api.getMe()),
     retry: false,
+    retryOnMount: false,   // THE loop breaker: a newly mounted observer must not refetch an errored query
     staleTime: 30_000,
   });
 }
 export function useHealth() {
   …
     retry: false,
+    retryOnMount: false,
     staleTime: 60_000,
```
(`OctoApi.mode` exists at adapter.ts:23. TypeScript infers `MeResponse | null` for the `useMe` data. `use-auth.ts:34` already does `me.data?.principal ?? null`. `signInAsGuest` → `invalidateQueries()` still refetches, because invalidation ignores `retryOnMount`.)

```diff
--- src/v2/components/auth/auth-gate.tsx
-  const { isDemo, isAuthenticated, isLoading } = useAuth();
+  const { isDemo, isAuthenticated, isLoading, isError } = useAuth();
   if (isDemo || isAuthenticated) return <>{children}</>;
-  if (isLoading) return <Splash />;
+  // Splash only for the very first resolution; never swap out a mounted LoginPage.
+  if (isLoading && !isError) return <Splash />;
   return <LoginPage />;
```
(Optional but cleaner: LoginPage gets `signInWithGoogle`/`signInAsGuest` as props or from a hook that doesn't subscribe to `useMe`. Then mounting the login screen can never touch the `["me"]` query.)

```diff
--- src/v2/data/live.ts  (defense-in-depth only)
     if (response.status === 401) { … }
+    if (response.status === 502 || response.status === 503 || response.status === 504) {
+      this.offlineUntil = Date.now() + OFFLINE_COOLDOWN_MS; // Vite proxy answers 502 for ECONNREFUSED
+      throw new OctoApiError({ status: 0, message: UNREACHABLE_MESSAGE });
+    }
```
```diff
--- vite.config.ts
-const quietExpectedRefusal = (…) => { … };   // lines 7-26: ineffective, remove
-        configure: quietExpectedRefusal,     // lines 44 and 49
```
Verify by opening the preview in live mode with no server. You should see one `/api/me` (or none without a token) and one `/health` proxy error, then silence. Then sign out with the server running: no repeated `/api/me` 401s.

---

## TASK 2: why v2 looks better than v1

### Where the design came from
- **Supabase brief: CONFIRMED.** `docs/frontend/DYAD_DASHBOARD_BRIEF.md:9` (paste-ready Dyad request, also quoted in chat msg 4, so it was in context for the build turn):
  > "Build a polished, responsive Octo workspace and operations dashboard from a clean slate. … Use Supabase's dashboard as a visual reference for strong navigation, useful information density, clear tables, and well-designed charts; keep Octo's own identity and workspace jobs rather than copying Supabase branding or its infrastructure controls."
  Line 13: "Use dark mode as the default. Keep colors, typography, spacing, borders, radii, and elevation behind semantic design tokens … Make the information hierarchy calm and legible: clear page title, workspace selector, a small number of high-value summary cards, useful tables, and charts only where trustworthy time-series data exists."
  Line 15: the "Demo data" / "Quota not configured" / "Telemetry not collected" honesty rules. These are visible all over v2 as badges and empty-state cards.
  `docs/UI_DIRECTION.md`: "Start fresh… Dark appearance is the default… clear hierarchy, generous spacing, one focused job per view."
- **Dyad Default Theme prompt: NOT used.** app `theme_id = NULL`, and the log says "Theme for app 1: none, prompt length: 0 chars". The code agrees: v2 `button.tsx`/`card.tsx` are near-stock shadcn (new-york-style `h-9 rounded-md`, `rounded-xl border bg-card shadow-sm`). The Default Theme's "Never ship default shadcn components" rule clearly wasn't applied.
- **App blueprint: NOT used.** `needs_app_blueprint = 0`. The app was imported from GitHub, not created through the new-app flow, and `planning_questionnaire` failed at 04:01.
- **Dyad scaffold: NOT used.** There's no `components.json`, no tailwind.config, and no scaffold `src/components/ui`. The model hand-wrote 18 shadcn-style components plus Radix deps itself in ea3fadc. The only indirect scaffold influence is `AI_RULES.md` (Dyad-generated, msg 1/2). It describes Dyad's default scaffold stack ("React 18 … shadcn/ui … Tailwind … lucide-react"), not this repo, and that seeded the shadcn/Tailwind choice. Alex then confirmed it (msg 11 "yeah no mui"; msg 15 locks in "React 19 + Vite + Tailwind + shadcn/ui + lucide-react + recharts + React Router + TanStack Query"). Msg 21: "make it have multiple interchangeable design system theme changer … make it look good."
- **Palette: inherited from v1, not new.** v2 "Midnight Lime" `--background hsl(228 14% 5%)` / `--primary hsl(80 74% 68%)` is v1's `#0b0c0e` / `#c5f36b` converted to HSL (v1/ui/theme.ts:36-42, dashboard.css:3-12). The same favicon and Inter font are in both. The difference is structure, not color.

### v1 vs v2 differences, ranked by visual impact
| # | Difference | v1 (e432152) | v2 (ea3fadc) | Source |
|---|---|---|---|---|
| 1 | Information architecture / density | "Calm home" consumer feel: big gradient hero (`.octo-overview-hero`, min-height 255px, radial glows), display type `clamp(42px,6vw,76px)`, few panels, 1 table in Dashboard.tsx | Supabase-style console: 4-up stat-card row (uppercase label, 2xl tabular value, icon tile, hint), card grid (Storage tiers + Quota, Recent files table + Activity, Service status + Policy), max-w-7xl, gap-6 | **Brief** (Supabase reference, "small number of high-value summary cards, useful tables") + model |
| 2 | Consistent component system | MUI widgets (Button×22, TextField×9, Dialog, Alert) mixed with ~1,200 lines of BEM CSS (`octo-panel`, `octo-file-row`…), two styling systems | One shadcn/cva component set (Card, Badge, Button, Table, Tabs, Select, DropdownMenu, Tooltip…), all on the same tokens, so radii/borders/type scale are uniform | User + AI_RULES choice (shadcn/Tailwind), model-authored |
| 3 | Shell / navigation | 248px grid sidebar, flat nav, custom SVG icons | Fixed `lg:pl-64` sidebar with brand block, active-workspace card, grouped nav ("Workspace" / "Platform → Fleet"), Service-status box; topbar with workspace selector, Demo/Live switcher, theme picker, avatar menu; demo banner; footer | **Brief** ("strong navigation", "workspace selector", owner vs tenant distinct) + model |
| 4 | Status semantics / color use | Accent used decoratively (lime success = accent) | Semantic `success/warning/destructive` tokens; pill badges (`rounded-full`, `/15` tint) for "Active · R2", "Restoring", "Demo data", "Platform owner"; stacked storage bar with chart-1..5 | **Brief** honesty rules + model |
| 5 | Typography hierarchy | Huge display headings, 9–13px body sizes scattered | Tight hierarchy: page title + description, `text-sm font-semibold` card titles, `text-xs` muted descriptions, uppercase tracking-wide labels, JetBrains Mono for ids/code, `tabular-nums` | Model (shadcn conventions) |
| 6 | Theme tokens | 2 systems (midnight/paper) as `--octo-*` hex + MUI createTheme; radius 10/16/24 (rounder) | 7 presets as `[data-theme]` HSL token blocks + Tailwind v4 `@theme inline` mapping; `--radius` per theme (0.5–1rem) with sm/md/lg/xl derived; `dark` custom variant driven by preset | User request (msg 21) + **brief** ("semantic design tokens") |
| 7 | Icons | 16 hand-drawn SVG paths (`ICON_PATHS`) | lucide-react everywhere (nav, stat tiles, alerts) | AI_RULES / stack choice |
| 8 | Elevation / effects | Large soft shadows (`0 24px 80px`), gradients, grain | Flat: 1px borders + `shadow-sm`, one subtle `grid-glow` on login only, one 0.28s `octo-in` entrance | Model (shadcn/Supabase idiom) |

Visible polish defect in v2 screenshots: native white scrollbars show on the sidebar and the recent-files table in Windows Chromium. `.scrollbar-slim` is WebKit-only and isn't applied to the table wrapper.

---

## Code quality / architecture notes
- Good: a clean `OctoApi` adapter seam (`adapter.ts` → `demo.ts`/`live.ts` → `hooks.ts` → pages); honest unavailable states; Fleet live mode returns `available:false` instead of fanning out; token-only theming; OAuth fragment capture before render.
- `src/v1` is dead code. Its relative imports (`../types/auth` etc.) are broken after the move, and it's excluded in tsconfig/vitest. MUI/Emotion deps are still in package.json and could be dropped.
- `AI_RULES.md` is wrong for this repo (React 18, `src/pages/Index.tsx`, `src/App.tsx`, "never edit library files"). Future Dyad turns will be misled. Update it to the real v2 layout.
- Two places own token storage: `session.ts` `TOKEN_KEY` and `live.ts:22` duplicate `"octo_token"`. `live.ts` clears it on 401 without notifying React.
- `useCreateApiKey` invalidates `queryKeys.activity("")` (hooks.ts:226), which never matches a real workspace key.
- `signOut` does `window.location.reload()`. Combined with the loop, that's why "after I logged out" re-triggered the storm.
- Commit 3c34a4c ("add Dyad component tagger") rewrote line endings across ~80+ files (equal +/- counts), which adds noise to blame/diff.
- Bundle is 930 kB (model's note). Route-level `lazy()` is recommended.
- PowerShell showed mojibake for curly quotes in app-shell.tsx. This is probably just Windows PowerShell 5 reading UTF-8 without a BOM (the screenshot renders fine). Not a code bug.

## Open questions
1. Should signed-out live mode skip the request entirely (my token short-circuit) or keep calling `/api/me` with cookies? I saw no cookie auth; it's bearer-only.
2. Was `octo.dataMode="live"` left in the preview's localStorage on purpose? Demo mode bypasses the gate completely.
3. Keep the 7 themes, or pick one? The Default Theme prompt was never applied. Setting a theme on the app in Dyad would change future turns' design pressure.
4. I had no v1 dashboard screenshot (only the v1 login, `.dyad/screenshot/75e5e72…png`). The v1 layout comparison comes from code.

---

## Verification (fix/auth-loop, 2026-10-03)
- `npm ci` → `npm run typecheck` passes. `npm run build` passes (only the existing >500 kB chunk warning). `npm test` → 23 files / 134 tests pass.
- Headless Chromium (Playwright 1.63), `vite` dev on :3000, nothing on :3001, `localStorage["octo.dataMode"]="live"`, 5 s window:

| Scenario | Before (dyad-v2 @ 57aa953) | After (fix/auth-loop) |
|---|---|---|
| No session token | 872 `/api/me` + 542 `/health`, stuck on "Resolving session…" | 0 `/api/me` + 1 `/health`, login screen with "Octo server unreachable" |
| Stale token stored | 815 `/api/me` + 493 `/health`, stuck on splash | 1 `/api/me` + 0 `/health` (breaker tripped on the 502), login screen with notice |
| Vite "http proxy error" lines | 2,726 (both runs, ~10 s) | 2 |
