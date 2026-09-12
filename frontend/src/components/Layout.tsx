import { NavLink, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../services/auth.tsx';

const ICON_PROPS = { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const ICONS = {
  dashboard: (
    <svg {...ICON_PROPS}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>
  ),
  newReview: (
    <svg {...ICON_PROPS}><path d="M12 5v14M5 12h14" /></svg>
  ),
  history: (
    <svg {...ICON_PROPS}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></svg>
  ),
  settings: (
    <svg {...ICON_PROPS}><line x1="4" y1="6" x2="20" y2="6" /><circle cx="9" cy="6" r="2" /><line x1="4" y1="12" x2="20" y2="12" /><circle cx="15" cy="12" r="2" /><line x1="4" y1="18" x2="20" y2="18" /><circle cx="9" cy="18" r="2" /></svg>
  ),
};

const LINKS = [
  { to: '/', label: 'Dashboard', end: true, icon: ICONS.dashboard },
  { to: '/reviews/new', label: 'New Review', icon: ICONS.newReview },
  { to: '/history', label: 'History', icon: ICONS.history },
  { to: '/settings', label: 'Settings', icon: ICONS.settings },
];

export default function Layout() {
  const { user, logout } = useAuth();

  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="dot" aria-hidden="true" />
          Code Reviewer
        </div>
        <nav aria-label="Primary">
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            >
              {link.icon}
              {link.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div>{user.email}</div>
          <button className="btn btn-ghost" style={{ marginTop: 8, padding: '6px 10px', fontSize: 13 }} onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
