import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  apiGet,
  apiSend,
  endSession,
  getStoredPrincipal,
  getToken,
  PRINCIPAL_KEY,
  SIGNED_OUT_EVENT,
  TOKEN_KEY,
} from './api';
import type { MeResponse, Principal } from './types';

const IDLE_LIMIT_MS = 20 * 60 * 1000;
const OAUTH_RETURN_KEY = 'octo_oauth_return';

/** The session token is `octo_sess_<id>.<expSeconds>.<sig>`; read its expiry. */
function tokenExpiryMs(token: string): number | null {
  if (!token.startsWith('octo_sess_')) return null;
  const exp = Number(token.split('.')[1]);
  return Number.isFinite(exp) ? exp * 1000 : null;
}

/** Only a same-origin /oauth/authorize URL is ever resumed; anything else is dropped. */
function safeAuthorizeUrl(value: string): string | null {
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    if (url.pathname !== '/oauth/authorize') return null;
    return url.toString();
  } catch {
    return null;
  }
}

interface SessionContextValue {
  principal: Principal | null;
  me: MeResponse | null;
  notice: string;
  ready: boolean;
  signIn: (session: { sessionToken: string; principal: Principal }) => void;
  signOut: () => void;
  refreshMe: () => Promise<void>;
  setNotice: (notice: string) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [principal, setPrincipal] = useState<Principal | null>(() => getStoredPrincipal<Principal>());
  const [me, setMe] = useState<MeResponse | null>(null);
  const [notice, setNotice] = useState('');
  const [ready, setReady] = useState(false);
  const lastActivity = useRef(Date.now());
  const resumedRef = useRef(false);

  const signOut = useCallback(() => {
    endSession();
    setPrincipal(null);
    setMe(null);
  }, []);

  const refreshMe = useCallback(async () => {
    const result = await apiGet<MeResponse>('/api/me');
    setMe(result);
    setPrincipal(result.principal);
    localStorage.setItem(PRINCIPAL_KEY, JSON.stringify(result.principal));
  }, []);

  // Consume the URL hash once, before any authenticated work.
  useEffect(() => {
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    if (!hash) return;
    const params = new URLSearchParams(hash);
    const hashToken = params.get('token');
    const authError = params.get('auth_error');
    const oauthReturn = params.get('oauth_return');

    if (hashToken) localStorage.setItem(TOKEN_KEY, hashToken);
    if (oauthReturn) {
      const safe = safeAuthorizeUrl(oauthReturn);
      if (safe) localStorage.setItem(OAUTH_RETURN_KEY, safe);
    }
    if (authError) setNotice('Google sign-in failed. Please try again.');

    // Never leave the token in the address bar.
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }, []);

  // Resolve the session on load: the server is the authority on a stored token.
  useEffect(() => {
    let cancelled = false;
    const token = getToken();
    if (!token) {
      setReady(true);
      return;
    }
    const expiry = tokenExpiryMs(token);
    if (expiry !== null && expiry <= Date.now()) {
      endSession();
      setPrincipal(null);
      setNotice('Your session expired. Please sign in again.');
      setReady(true);
      return;
    }
    refreshMe()
      .catch(() => {
        if (cancelled) return;
        endSession();
        setPrincipal(null);
        setNotice('Your session expired. Please sign in again.');
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshMe]);

  // A 401 anywhere in the app ends the session and returns to login.
  useEffect(() => {
    const onSignedOut = () => {
      setPrincipal(null);
      setMe(null);
      setNotice('Your session expired. Please sign in again.');
    };
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, []);

  // 20-minute idle expiry, mirrored from the server's own timeout.
  useEffect(() => {
    const markActive = () => {
      lastActivity.current = Date.now();
    };
    const events: (keyof WindowEventMap)[] = [
      'click',
      'keydown',
      'pointerdown',
      'scroll',
      'touchstart',
    ];
    events.forEach((event) => window.addEventListener(event, markActive, { passive: true }));
    const interval = window.setInterval(() => {
      if (!getToken()) return;
      if (Date.now() - lastActivity.current > IDLE_LIMIT_MS) signOut();
    }, 30_000);
    return () => {
      events.forEach((event) => window.removeEventListener(event, markActive));
      window.clearInterval(interval);
    };
  }, [signOut]);

  // Resume an MCP connector's authorization once a session exists.
  useEffect(() => {
    if (!principal || resumedRef.current) return;
    const stashed = localStorage.getItem(OAUTH_RETURN_KEY);
    if (!stashed) return;
    resumedRef.current = true;
    localStorage.removeItem(OAUTH_RETURN_KEY);
    const target = safeAuthorizeUrl(stashed);
    if (!target) return;
    apiSend('/oauth/dance', 'POST')
      .then(() => window.location.replace(target))
      .catch(() => undefined);
  }, [principal]);

  const signIn = useCallback((session: { sessionToken: string; principal: Principal }) => {
    localStorage.setItem(TOKEN_KEY, session.sessionToken);
    localStorage.setItem(PRINCIPAL_KEY, JSON.stringify(session.principal));
    setPrincipal(session.principal);
    setNotice('');
    refreshMe().catch(() => undefined);
  }, [refreshMe]);

  const value: SessionContextValue = {
    principal,
    me,
    notice,
    ready,
    signIn,
    signOut,
    refreshMe,
    setNotice,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used within SessionProvider');
  return context;
}
