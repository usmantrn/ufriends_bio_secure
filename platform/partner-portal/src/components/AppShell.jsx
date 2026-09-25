import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const NAV = [
  { icon: '📊', label: 'Dashboard', path: '/' },
  { icon: '👥', label: 'My Agents', path: '/agents' },
  { icon: '📋', label: 'Enrollments', path: '/enrollments' },
  { icon: '⛔', label: 'Strikes', path: '/strikes' },
  { icon: '👤', label: 'Profile', path: '/profile' },
];

export default function AppShell({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => { await logout(); navigate('/login'); };
  const initials = user?.fullName?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="logo">
            <div className="logo-icon">🏢</div>
            <div>
              <div className="logo-title">Ufriends BioSecure</div>
              <div className="logo-sub">Partner Portal</div>
            </div>
          </div>
        </div>

        {user?.organization && (
          <div className="org-badge">
            <div className="org-badge-name">{user.organization.name}</div>
            <div className="org-badge-role">{user.role.replace(/_/g, ' ')}</div>
          </div>
        )}

        <nav className="sidebar-nav">
          <div className="nav-label">Navigation</div>
          {NAV.map(item => {
            const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
            return (
              <div
                key={item.path}
                id={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                className={`nav-item ${isActive ? 'active' : ''}`}
                onClick={() => navigate(item.path)}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="user-card" onClick={handleLogout} title="Click to logout">
            <div className="user-avatar">{initials}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="user-name">{user?.fullName?.split(' (')[0] || 'User'}</div>
              <div className="user-role">{user?.role?.replace(/_/g, ' ')}</div>
            </div>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>→</span>
          </div>
        </div>
      </aside>

      <main className="main-content">{children}</main>
    </div>
  );
}
