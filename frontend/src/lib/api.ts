// Same-origin client for Octo's HTTP API. Every authenticated call carries the
// bearer session token; a 401 ends the session and returns the app to login.

export const TOKEN_KEY = 'octo_token';
export const PRINCIPAL_KEY = 'octo_principal';
export const SIGNED_OUT_EVENT = 'octo-signed-out';

export class ApiError extends Error {
  status: number;
  code: string | undefined;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredPrincipal<T>(): T | null {
  const raw = localStorage.getItem(PRINCIPAL_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Clears the session and notifies the app so it can return to the login screen. */
export function endSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(PRINCIPAL_KEY);
  window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
}

export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  const raw = body.error ?? response.statusText;
  // Server errors read "CODE: human message"; keep both.
  const code = raw.includes(':') ? raw.slice(0, raw.indexOf(':')).trim() : raw;
  return new ApiError(raw, response.status, code);
}

/** GET a JSON resource. Throws ApiError; a 401 ends the session. */
export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: authHeaders() });
  if (response.status === 401) {
    endSession();
    throw new ApiError('Session expired', 401, 'UNAUTHENTICATED');
  }
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as T;
}

/** POST/PATCH/DELETE with an optional JSON body. */
export async function apiSend<T>(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: {
      ...authHeaders(),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401) {
    endSession();
    throw new ApiError('Session expired', 401, 'UNAUTHENTICATED');
  }
  if (!response.ok) throw await parseError(response);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) return undefined as T;
  return (await response.json()) as T;
}

/**
 * A server error reads "CODE: human message". Show the code so the reader can
 * recognise it (a form needs the code, e.g. WORKSPACE_DAILY_LIMIT) and the
 * sentence so the screen is not just a token.
 */
export function formError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Could not complete this action.';
  const separator = message.indexOf(':');
  if (separator === -1) return message;
  const code = message.slice(0, separator).trim();
  const detail = message.slice(separator + 1).trim();
  if (!/^[A-Z][A-Z0-9_]*$/.test(code)) return message;
  return detail ? `${code} — ${detail}` : code;
}

/** GET raw bytes as a Blob (file content downloads). */
export async function apiBlob(path: string): Promise<Blob> {
  const response = await fetch(path, { headers: authHeaders() });
  if (response.status === 401) {
    endSession();
    throw new ApiError('Session expired', 401, 'UNAUTHENTICATED');
  }
  if (!response.ok) throw await parseError(response);
  return response.blob();
}

/** Anonymous GET for the public share viewer — no token, no 401 session handling. */
export async function publicGet<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as T;
}

export const ws = (id: string) => `workspaceId=${encodeURIComponent(id)}`;
