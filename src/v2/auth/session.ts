/**
 * Session token storage and OAuth redirect handling.
 *
 * The browser only ever holds an opaque session token. It never holds a
 * provider or database credential, and authorization stays server-side.
 */

const TOKEN_KEY = "octo_token";
const PRINCIPAL_KEY = "octo_principal";

/**
 * Holds the reason a redirect-based sign-in failed.
 *
 * Kept in a module variable rather than cleared-on-read state so that React
 * StrictMode's double-invoked render cannot consume it before it is displayed.
 */
let pendingAuthError: string | null = null;

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage unavailable — the session simply will not persist */
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(PRINCIPAL_KEY);
  } catch {
    /* ignore */
  }
}

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  GOOGLE_AUTH_NOT_CONFIGURED:
    "Google sign-in is not configured on this server. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET, or continue as a guest.",
  MISSING_CODE: "Google did not return an authorization code. Try again.",
  TOKEN_EXCHANGE_FAILED: "Google rejected the token exchange. Check the OAuth client credentials.",
  MISSING_PROFILE: "Google did not return a usable profile (sub/email).",
  INTERNAL_ERROR: "The server hit an internal error during sign-in.",
  access_denied: "Google sign-in was cancelled or denied.",
};

export function describeAuthError(code: string): string {
  return AUTH_ERROR_MESSAGES[code] ?? `Sign-in failed (${code}).`;
}

export interface OAuthCapture {
  token: string | null;
  error: string | null;
}

/**
 * Reads `#token=...` or `#auth_error=...` from the OAuth callback fragment.
 *
 * Must run synchronously before the first render so the token is in storage
 * before the app's first `GET /api/me`.
 */
export function captureOAuthRedirect(): OAuthCapture {
  if (typeof window === "undefined") return { token: null, error: null };

  const hash = window.location.hash;
  if (!hash || hash === "#" || !hash.startsWith("#")) return { token: null, error: null };

  const params = new URLSearchParams(hash.slice(1));
  const token = params.get("token");
  const error = params.get("auth_error");
  if (!token && !error) return { token: null, error: null };

  if (token) setToken(token);
  if (error) pendingAuthError = error;

  // Clean the fragment so a refresh does not replay a stale token or error.
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  return { token, error };
}

/**
 * The pending sign-in error, if the last redirect failed.
 *
 * Intentionally a pure read: it stays visible on the login screen until the
 * session changes or the page reloads.
 */
export function getAuthError(): string | null {
  return pendingAuthError;
}
