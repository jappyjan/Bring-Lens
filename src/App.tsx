import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SettingsProvider } from './contexts/SettingsContext';
import { BringProvider } from './contexts/BringContext';
import { Shell } from './layouts/Shell';
import { Login } from './screens/Login';
import { Home } from './screens/Home';
import { Settings } from './screens/Settings';
import { BringGlasses } from './glass/BringGlasses';

/**
 * Route guard: while we're still hydrating credentials from storage we
 * show nothing to avoid a login flash; once decided we either let the
 * children through or bounce to /login.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <div className="bl-spin">Loading…</div>;
  if (status === 'signed-out') return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <SettingsProvider>
      <AuthProvider>
        <BringProvider>
          <BrowserRouter>
            {/* Headless component that drives the glasses display. */}
            <BringGlasses />
            <Routes>
              <Route element={<Shell />}>
                <Route
                  path="/"
                  element={
                    <RequireAuth>
                      <Home />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <RequireAuth>
                      <Settings />
                    </RequireAuth>
                  }
                />
                <Route path="/login" element={<Login />} />
                {/* The glasses-only routes still need to mount something
                    on the phone side so the URL is valid; we just bounce
                    to home. */}
                <Route
                  path="/glasses/lists"
                  element={<Navigate to="/" replace />}
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </BringProvider>
      </AuthProvider>
    </SettingsProvider>
  );
}
