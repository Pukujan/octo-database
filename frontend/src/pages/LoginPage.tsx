import { useCallback, useEffect, useRef, useState } from 'react';
import { apiSend } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import type { HealthResponse, Principal } from '@/lib/types';

interface TurnstileApi {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  reset: (id?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

// The guest button must never dead-end: Turnstile issues a single-use token that
// expires (~5 min), so the widget re-renders on every login draw and a stale
// token is dropped before the sign-in call.
function useTurnstile(siteKey: string | null, theme: string) {
  const slotRef = useRef<HTMLDivElement | null>(null);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!siteKey || !slotRef.current) return;
    tokenRef.current = null;
    const slot = slotRef.current;
    const renderWidget = () => {
      if (!window.turnstile || !slot.isConnected) return;
      window.turnstile.render(slot, {
        sitekey: siteKey,
        theme: theme === 'paper' ? 'light' : 'dark',
        callback: (token: string) => {
          tokenRef.current = token;
        },
        'expired-callback': () => {
          tokenRef.current = null;
        },
      });
    };
    if (window.turnstile) {
      renderWidget();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = renderWidget;
    document.head.appendChild(script);
  }, [siteKey, theme]);

  const getToken = useCallback(() => {
    const token = tokenRef.current;
    tokenRef.current = null;
    return token;
  }, []);

  return { slotRef, getToken };
}

export default function LoginPage() {
  const { notice, signIn, setNotice } = useSession();
  const { theme } = useTheme();
  const [googleAuthEnabled, setGoogleAuthEnabled] = useState(false);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { slotRef, getToken } = useTurnstile(turnstileSiteKey, theme);

  useEffect(() => {
    let cancelled = false;
    fetch('/health')
      .then(async (response) => (response.ok ? ((await response.json()) as HealthResponse) : null))
      .then((health) => {
        if (cancelled || !health) return;
        setGoogleAuthEnabled(Boolean(health.googleAuthEnabled));
        setTurnstileSiteKey(typeof health.turnstileSiteKey === 'string' ? health.turnstileSiteKey : null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const guest = async () => {
    if (turnstileSiteKey && !getToken()) {
      setNotice('Please complete the human check before continuing.');
      return;
    }
    setBusy(true);
    try {
      const result = await apiSend<{ principal: Principal; sessionToken: string; workspace: unknown }>(
        '/api/auth/guest',
        'POST',
        { displayName: 'Guest User', turnstileToken: getToken() || undefined }
      );
      signIn({ sessionToken: result.sessionToken, principal: result.principal });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-screen" data-testid="login-screen">
      <section className="login-card">
        <div className="brand-lockup">
          <span className="brand-mark">◉</span>
          <span>octo</span>
        </div>
        <p className="eyebrow">WORKSPACE DATA PLATFORM</p>
        <h1>Welcome to Octo</h1>
        <p className="login-copy">A calm home for your workspace data, files, and activity.</p>
        {notice ? (
          <p className="login-notice" role="alert">
            {notice}
          </p>
        ) : null}
        <div className="login-actions">
          {googleAuthEnabled ? (
            <button
              className="button google-button"
              type="button"
              data-testid="login-google"
              onClick={() => {
                window.location.href = '/api/auth/google';
              }}
            >
              <span className="google-g">G</span>Sign in with Google
            </button>
          ) : (
            <button
              className="button google-button"
              disabled
              type="button"
              data-testid="login-google"
              aria-label="Google sign-in not configured"
            >
              <span className="google-g">G</span>Google sign-in not configured
            </button>
          )}
          {turnstileSiteKey ? <div className="turnstile-slot" ref={slotRef} /> : null}
          <button className="button primary" type="button" data-testid="login-guest" onClick={guest} disabled={busy}>
            Continue as Guest<span aria-hidden="true">→</span>
          </button>
        </div>
        <p className="login-note">Your workspaces stay separate and scoped to your account.</p>
      </section>
      <div className="login-art" aria-hidden="true">
        <div className="orb orb-one" />
        <div className="orb orb-two" />
        <div className="art-grid" />
        <div className="art-caption">
          <span className="live-dot" /> Your workspace, in one place
        </div>
      </div>
    </main>
  );
}
