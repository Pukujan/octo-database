import * as React from "react";
import { AlertTriangle, ArrowRight, ServerCrash, UserRound } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@v2/components/ui/alert";
import { Badge } from "@v2/components/ui/badge";
import { Button } from "@v2/components/ui/button";
import { Separator } from "@v2/components/ui/separator";
import { ThemeSwitcher } from "@v2/components/layout/theme-switcher";
import { useAuth } from "@v2/auth/use-auth";
import { describeAuthError, getAuthError } from "@v2/auth/session";
import { useHealth } from "@v2/data/hooks";
import { useOctoData } from "@v2/data/provider";

export function LoginPage() {
  const { signInWithGoogle, signInAsGuest } = useAuth();
  const { setMode } = useOctoData();
  const health = useHealth();

  const [pending, setPending] = React.useState(false);
  const [guestError, setGuestError] = React.useState<string | null>(null);
  const oauthError = getAuthError();

  const serverUnreachable = health.isError;
  const googleEnabled = health.data?.googleAuthEnabled ?? false;

  async function handleGuest() {
    setPending(true);
    setGuestError(null);
    const result = await signInAsGuest();
    if (!result.ok) setGuestError(result.error ?? "Guest sign-in failed.");
    setPending(false);
  }

  return (
    <div className="grid-glow flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex h-14 items-center justify-end px-4 sm:px-6">
        <ThemeSwitcher />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-16 sm:px-6">
        <div className="w-full max-w-md">
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/15">
              <svg viewBox="0 0 64 64" className="size-7" aria-hidden="true">
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
            <div className="flex flex-col gap-1">
              <h1 className="text-lg font-semibold tracking-tight">Sign in to Octo</h1>
              <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                Octo is a multi-tenant workspace platform. Access is granted per authorized
                workspace, and the server enforces every action.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-sm">
            {oauthError ? (
              <Alert variant="destructive">
                <AlertTriangle />
                <div className="flex flex-col gap-1">
                  <AlertTitle>Sign-in failed</AlertTitle>
                  <AlertDescription>{describeAuthError(oauthError)}</AlertDescription>
                </div>
              </Alert>
            ) : null}

            {serverUnreachable ? (
              <Alert variant="warning">
                <ServerCrash />
                <div className="flex flex-col gap-1">
                  <AlertTitle>Octo server unreachable</AlertTitle>
                  <AlertDescription>
                    Start the API with <code className="font-mono">npm run server</code> (port
                    3001), or explore the labelled prototype instead.
                  </AlertDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => setMode("demo")}>
                  Use demo data
                </Button>
              </Alert>
            ) : null}

            <div className="flex flex-col gap-2">
              <Button
                onClick={signInWithGoogle}
                disabled={!googleEnabled || serverUnreachable}
                className="w-full"
              >
                Continue with Google
                <ArrowRight className="size-4" />
              </Button>
              {!googleEnabled && !serverUnreachable ? (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Google sign-in is not configured on this server. Set{" "}
                  <code className="font-mono">GOOGLE_OAUTH_CLIENT_ID</code> and{" "}
                  <code className="font-mono">GOOGLE_OAUTH_CLIENT_SECRET</code>, or continue as a
                  guest.
                </p>
              ) : null}
            </div>

            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">or</span>
              <Separator className="flex-1" />
            </div>

            <div className="flex flex-col gap-2">
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => void handleGuest()}
                disabled={pending || serverUnreachable}
              >
                <UserRound className="size-4" />
                {pending ? "Creating guest workspace…" : "Continue as guest"}
              </Button>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Provisions a personal sandbox workspace you own. No email or password required.
              </p>
            </div>

            {guestError ? (
              <Alert variant="destructive">
                <AlertTriangle />
                <div className="flex flex-col gap-1">
                  <AlertTitle>Could not sign in</AlertTitle>
                  <AlertDescription>{guestError}</AlertDescription>
                </div>
              </Alert>
            ) : null}
          </div>

          <div className="mt-4 flex flex-col items-center gap-2 text-center">
            <span className="flex items-center gap-2">
              <Badge variant="outline">No provider credentials in the browser</Badge>
            </span>
            <button
              type="button"
              onClick={() => setMode("demo")}
              className="text-[11px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Explore the prototype with demo data instead
            </button>
          </div>

          {health.data ? (
            <p className="mt-6 text-center text-[11px] text-muted-foreground">
              Server v{health.data.version} · PostgreSQL{" "}
              {health.data.database.connected ? "connected" : "unavailable"} · R2{" "}
              {health.data.r2.connected ? health.data.r2.bucket ?? "connected" : "unavailable"}
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
