import { NavLink, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../services/auth.tsx';

const LINKS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/reviews/new', label: 'New Review' },
  { to: '/history', label: 'History' },
  { to: '/settings', label: 'Settings' },
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
