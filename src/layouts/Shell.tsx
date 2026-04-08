import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../contexts/AuthContext';

/**
 * The phone-app shell: a top bar with a brand + navigation, and an
 * `<Outlet />` where the active route renders.
 */
export function Shell() {
  const { status } = useAuth();
  return (
    <div className="bl-shell">
      <header className="bl-topbar">
        <div className="bl-brand">
          <span className="bl-brand-dot" />
          Bring Lens
        </div>
        <nav className="bl-nav">
          {status === 'signed-in' ? (
            <>
              <NavLink
                to="/"
                end
                className={({ isActive }) => (isActive ? 'active' : '')}
              >
                List
              </NavLink>
              <NavLink
                to="/settings"
                className={({ isActive }) => (isActive ? 'active' : '')}
              >
                Settings
              </NavLink>
            </>
          ) : null}
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
