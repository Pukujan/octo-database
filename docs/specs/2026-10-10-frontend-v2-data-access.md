# Data access — Octo workspace portal

This replaces the generator's default data-access block. The app is a **client of Octo's
existing same-origin HTTP API**. There is no fixture layer, no view layer, and no analytics
schema. Read and write through the routes below.

## Rules

- **Same-origin only.** Call the API with relative paths (`/api/...`, `/health`,
  `/oauth/dance`). The Vite dev server proxies these to the API; in production the API server
  serves the built app. Never hardcode a host or a port.
- **Fetch with `@tanstack/react-query`.** One `useQuery` per collection keyed by
  `['<resource>', workspaceId]`; mutations via `useMutation` with `invalidateQueries` on
  success. Show loading skeletons and error states.
- **Auth header.** Every `/api/...` request carries `Authorization: Bearer <token>`, where
  `<token>` is the session token read from `localStorage.getItem('octo_token')`. JSON bodies
  also set `Content-Type: application/json`.
- **401 means signed out.** Any 401 from an authenticated `/api/...` call ends the session:
  clear `octo_token` and `octo_principal`, and return to the login screen. Do not retry.
- **Workspace scope.** Workspace-scoped routes take `?workspaceId=<id>` as a query parameter
  (not a body field). The active workspace id comes from the workspace picker.
- **Never call `/api/views/:name`.** There is no views endpoint and no `v_*` schema in Octo.
  Every collection below is a real route with a real row shape.
- **Never call** `/api/rag/*`, `/api/epistemic/*`, `/api/graph/*`, or
  `/api/workspaces/:id/query`.

## Query example — the workspace's files

```ts
import { useQuery } from '@tanstack/react-query';

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('octo_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: authHeaders() });
  if (res.status === 401) { onSignedOut(); throw new Error('Session expired'); }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

type FileRecord = {
  id: string; name: string; sizeBytes: number; mimeType: string;
  storageKey: string; createdAt: string; archiveState: string;
  publishedAt: string | null; publishedUrl: string | null;
};

function useFiles(workspaceId: string) {
  return useQuery({
    queryKey: ['files', workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => getJson<FileRecord[]>(`/api/files?workspaceId=${encodeURIComponent(workspaceId)}`),
  });
}
```

## Mutation example — mint an API key through the confirm-code gate

Destructive and credential-creating calls need a confirmation code that a human types. Fetch a
fresh code, display it, then send it as `confirmSecret`.

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 401) { onSignedOut(); throw new Error('Session expired'); }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    // 412 CONFIRM_SECRET_NOT_SET -> route the human to set a confirmation secret.
    throw Object.assign(new Error(err.error ?? res.statusText), { code: err.error });
  }
  return res.json() as Promise<T>;
}

// 1) Get a code to display on the form.
const { code } = await postJson<{ code: string }>('/api/me/confirm-challenge', {});

// 2) The human types `code` into the form's `secret` field; submit with it attached.
function useMintKey(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; scopes: string[]; expiresInDays?: number;
                          confirmSecret: string; mfaCode?: string }) =>
      postJson<{ apiKey: ApiKey; rawSecret: string }>('/api/keys', {
        name: input.name,
        workspaceId,
        scopes: input.scopes,
        expiresInDays: input.expiresInDays,
        confirmSecret: input.confirmSecret,
        mfaCode: input.mfaCode,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['keys', workspaceId] }),
  });
}
// The response's `rawSecret` is shown once and never persisted.
```

## Error handling

- `412 CONFIRM_SECRET_NOT_SET` — the account has no confirmation secret yet. Prompt the human
  to set one with `POST /api/me/confirm-secret` (`{secret}`), then retry.
- `403` — the key or session lacks the required scope (for example `delete`).
- `409` — a conflict such as `SLUG_TAKEN` or `ACCOUNT_KEY_EXISTS`; surface the code.
- `429 WORKSPACE_DAILY_LIMIT` — the workspace-creation quota for the day is spent.
- `404 SHARE_NOT_FOUND_OR_INACTIVE` — the public share link is gone; show the "not available"
  state, not an error.

## One-time secrets

A minted key's `rawSecret` and a new share's `<origin>/share/<rawToken>` are shown exactly
once. Keep them in component state for the current render only, never in `localStorage`, and
clear them on dismiss and on sign-out.
