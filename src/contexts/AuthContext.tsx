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
   * Synchronous accessor for the current credential bundle. The proxy
   * is stateless and there's no token to refresh, so this is just a
   * thin wrapper around the React state ref. Returns null when the
   * user is signed out.
   */
  getAuth(): BringAuth | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<BringAuth | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const authRef = useRef<BringAuth | null>(null);
  authRef.current = auth;

  // Restore persisted credentials on mount. We treat anything that
  // doesn't carry an `email`/`password` pair as stale (e.g. blobs
  // from older versions that stored access/refresh tokens) and force
  // a re-login.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await getJson<BringAuth>(StorageKeys.auth);
      if (cancelled) return;
      if (stored && stored.email && stored.password) {
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

  const getAuth = useCallback((): BringAuth | null => authRef.current, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, auth, error, signIn, signOut, getAuth }),
    [status, auth, error, signIn, signOut, getAuth],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
