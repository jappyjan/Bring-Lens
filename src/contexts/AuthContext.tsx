import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  login as bringLogin,
  refreshAccessToken,
  BringApiError,
  type BringAuth,
} from '../lib/bring-client';
import { getJson, removeItem, setJson, StorageKeys } from '../lib/storage';

type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

interface AuthContextValue {
  status: AuthStatus;
  auth: BringAuth | null;
  error: string | null;
  signIn(email: string, password: string, country?: string): Promise<void>;
  signOut(): Promise<void>;
  /**
   * Lazily refresh the access token if we're within 5 minutes of expiry.
   * Returns the current (possibly updated) auth record, or null if the
   * user isn't signed in.
   */
  getFreshAuth(): Promise<BringAuth | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 minutes before expiry

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<BringAuth | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const authRef = useRef<BringAuth | null>(null);
  authRef.current = auth;

  // Restore persisted credentials on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await getJson<BringAuth>(StorageKeys.auth);
      if (cancelled) return;
      if (stored && stored.uuid && stored.accessToken) {
        setAuth(stored);
        setStatus('signed-in');
      } else {
        setStatus('signed-out');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (next: BringAuth | null) => {
    if (next) {
      await setJson(StorageKeys.auth, next);
    } else {
      await removeItem(StorageKeys.auth);
    }
  }, []);

  const signIn = useCallback(
    async (email: string, password: string, country = 'DE') => {
      setError(null);
      try {
        const next = await bringLogin(email, password, country);
        setAuth(next);
        setStatus('signed-in');
        await persist(next);
      } catch (err) {
        // Prefer the rich multi-line detail from BringApiError so the
        // Login screen can show URL / status / body / underlying cause
        // instead of a bare "Load failed" string.
        const message =
          err instanceof BringApiError
            ? err.toDetail()
            : err instanceof Error
              ? err.message
              : String(err);
        setError(message);
        throw err;
      }
    },
    [persist],
  );

  const signOut = useCallback(async () => {
    setAuth(null);
    setStatus('signed-out');
    setError(null);
    await persist(null);
  }, [persist]);

  const getFreshAuth = useCallback(async (): Promise<BringAuth | null> => {
    const current = authRef.current;
    if (!current) return null;
    if (current.expiresAt - Date.now() > REFRESH_BUFFER_MS) return current;

    try {
      const refreshed = await refreshAccessToken(current);
      authRef.current = refreshed;
      setAuth(refreshed);
      await persist(refreshed);
      return refreshed;
    } catch (err) {
      console.warn('[bring-lens] token refresh failed; signing out.', err);
      setAuth(null);
      setStatus('signed-out');
      await persist(null);
      return null;
    }
  }, [persist]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, auth, error, signIn, signOut, getFreshAuth }),
    [status, auth, error, signIn, signOut, getFreshAuth],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
