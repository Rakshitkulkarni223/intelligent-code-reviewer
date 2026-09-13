import { useState } from 'react';
import { NavLink, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../services/auth.tsx';

const COLLAPSED_KEY = 'icr_sidebar_collapsed';

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
  signOut: (
    <svg {...ICON_PROPS}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>
  ),
  // "menu-fold" -- mirrored to "menu-unfold" via CSS when collapsed (see
  // .sidebar.collapsed .sidebar-toggle svg) so the arrow always points the
  // direction the click will actually move the sidebar.
  collapse: (
    <svg {...ICON_PROPS} width={22} height={22} strokeWidth={1.8}>
      <line x1="4" y1="5" x2="20" y2="5" />
      <line x1="11" y1="9.5" x2="20" y2="9.5" />
      <line x1="11" y1="14.5" x2="20" y2="14.5" />
      <line x1="4" y1="19" x2="20" y2="19" />
      <polygon points="9,8 9,16 4,12" fill="currentColor" stroke="none" />
    </svg>
  ),
};

const LINKS = [
  { to: '/', label: 'Dashboard', end: true, icon: ICONS.dashboard },
  { to: '/reviews/new', label: 'New Review', icon: ICONS.newReview },
  { to: '/history', label: 'History', icon: ICONS.history },
  { to: '/settings', label: 'Settings', icon: ICONS.settings },
];

function isSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export default function Layout() {
  const { user, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(isSidebarCollapsed);

  if (!user) return <Navigate to="/login" replace />;

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      // Collapse still works for this session even if it can't persist.
    }
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
        <div className="sidebar-brand">
          <span className="dot" aria-hidden="true" />
          <span className="brand-text">Code Reviewer</span>
          <button
            className="sidebar-toggle"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {ICONS.collapse}
          </button>
        </div>
        <div className="nav-section-label">Menu</div>
        <nav aria-label="Primary" className="nav-links">
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              aria-label={link.label}
              title={collapsed ? link.label : undefined}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            >
              {link.icon}
              <span className="nav-label">{link.label}</span>
            </NavLink>
          ))}
        </nav>
        <button className="mobile-signout" onClick={logout} aria-label="Sign out" title="Sign out">
          {ICONS.signOut}
        </button>
        <div className="sidebar-footer">
          <div className="account-avatar" aria-hidden="true">{user.email.charAt(0).toUpperCase()}</div>
          <div className="account-email" title={user.email}>{user.email}</div>
          <button className="account-signout" onClick={logout} aria-label="Sign out" title="Sign out">
            {ICONS.signOut}
          </button>
        </div>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
      <nav className="bottom-tab-bar" aria-label="Primary">
        {LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) => `bottom-tab-item${isActive ? ' active' : ''}`}
          >
            {link.icon}
            <span>{link.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
