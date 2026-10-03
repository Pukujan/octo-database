import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useMe } from "@v2/data/hooks";
import { useOctoData } from "@v2/data/provider";
import type { DataMode } from "@v2/data/adapter";
import type { Principal } from "@v2/types/octo";
import { clearSession, setToken } from "./session";

export interface SignInResult {
  ok: boolean;
  error?: string;
}

export interface AuthState {
  mode: DataMode;
  /** Demo fixtures are always "signed in" as the demo principal. */
  isDemo: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  principal: Principal | null;
  signInWithGoogle: () => void;
  signInAsGuest: (displayName?: string) => Promise<SignInResult>;
  signOut: () => void;
}

export function useAuth(): AuthState {
  const { mode } = useOctoData();
  const me = useMe();
  const client = useQueryClient();

  const isDemo = mode === "demo";
  const principal = me.data?.principal ?? null;

  const signInWithGoogle = useCallback(() => {
    // Server redirects back with `#token=` (or `#auth_error=`).
    window.location.href = "/api/auth/google";
  }, []);

  const signInAsGuest = useCallback(
    async (displayName = "Guest User"): Promise<SignInResult> => {
      try {
        const response = await fetch("/api/auth/guest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName }),
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          return {
            ok: false,
            error: body.error ?? `Guest sign-in failed (${response.status}).`,
          };
        }

        const data = (await response.json()) as { sessionToken?: string };
        if (data.sessionToken) setToken(data.sessionToken);
        // Re-resolve identity and every workspace-scoped query for the new session.
        await client.invalidateQueries();
        return { ok: true };
      } catch {
        return {
          ok: false,
          error:
            "Cannot reach the Octo server. Start it with `npm run server`, or switch the data source to Demo fixtures.",
        };
      }
    },
    [client],
  );

  const signOut = useCallback(() => {
    clearSession();
    client.clear();
    window.location.reload();
  }, [client]);

  return {
    mode,
    isDemo,
    isAuthenticated: Boolean(principal),
    isLoading: me.isLoading,
    isError: me.isError,
    error: me.error,
    principal,
    signInWithGoogle,
    signInAsGuest,
    signOut,
  };
}
