import * as React from "react";
import { useAuth } from "@v2/auth/use-auth";
import { LoginPage } from "@v2/pages/login";

function Splash() {
  return (
    <div className="grid-glow flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-xl bg-primary/15">
          <svg viewBox="0 0 64 64" className="size-6" aria-hidden="true">
            <path
              d="M32 14c-10 0-18 7-18 16 0 6 3 10 9 13l-4 11 10-6h6l10 6-4-11c6-3 9-7 9-13 0-9-8-16-18-16Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="3.5"
              strokeLinejoin="round"
              className="text-primary"
            />
          </svg>
        </span>
        <span className="text-sm text-muted-foreground">Resolving session…</span>
      </div>
    </div>
  );
}

/**
 * Gates the authenticated shell.
 *
 * Demo mode is never gated — the prototype must stay immediately explorable.
 * In live mode the shell renders only once `GET /api/me` returns a principal;
 * a failed or missing session shows the login screen rather than an empty
 * authenticated shell.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { isDemo, isAuthenticated, isLoading } = useAuth();

  if (isDemo || isAuthenticated) return <>{children}</>;
  if (isLoading) return <Splash />;
  return <LoginPage />;
}
