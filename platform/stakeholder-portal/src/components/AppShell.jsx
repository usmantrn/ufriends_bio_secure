import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { io } from 'socket.io-client';

const NAV_ITEMS = [
  { icon: '📊', label: 'Dashboard', path: '/', badge: null },
  { icon: '👥', label: 'Agents', path: '/agents', badge: null },
  { icon: '🏢', label: 'Organizations', path: '/organizations', badge: null },
  { icon: '📋', label: 'Enrollments', path: '/enrollments', badge: null },
  { icon: '⚡', label: 'Flags & Alerts', path: '/flags', badgeKey: 'openFlags', badgeType: 'danger' },
  { icon: '⛔', label: 'Strikes', path: '/strikes', badgeKey: 'unresolvedStrikes', badgeType: 'warning' },
  { icon: '📜', label: 'Audit Trail', path: '/audit', badge: null },
  { icon: '⚙️', label: 'Settings', path: '/settings', badge: null, adminOnly: true },
];

export default function AppShell({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const socketRef = useRef(null);
  const [badges, setBadges] = useState({ openFlags: 0, unresolvedStrikes: 0 });
  const [connected, setConnected] = useState(false);
  const [liveEvents, setLiveEvents] = useState([]);

  useEffect(() => {
    // Fetch initial badge counts
    fetch('/api/dashboard/stats', { headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` } })
      .then(r => r.json())
      .then(data => {
        setBadges({
          openFlags: data.flags?.open || 0,
          unresolvedStrikes: data.strikes?.unresolved || 0,
        });
      }).catch(() => {});

    // Connect Socket.io
    const socket = io('/', { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join:stakeholder');
    });

    socket.on('disconnect', () => setConnected(false));

    socket.on('enrollment:new', (data) => {
      setLiveEvents(prev => [{ type: 'enrollment', ...data, id: Date.now() }, ...prev.slice(0, 9)]);
    });

    socket.on('strike:issued', (data) => {
      setBadges(b => ({ ...b, unresolvedStrikes: b.unresolvedStrikes + 1 }));
      setLiveEvents(prev => [{ type: 'strike', ...data, id: Date.now() }, ...prev.slice(0, 9)]);
    });

    socket.on('flag:raised', (data) => {
      setBadges(b => ({ ...b, openFlags: b.openFlags + 1 }));
      setLiveEvents(prev => [{ type: 'flag', ...data, id: Date.now() }, ...prev.slice(0, 9)]);
    });

    return () => socket.disconnect();
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const getInitials = (name) => name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '??';

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="logo">
            <div className="logo-icon">🛡️</div>
            <div className="logo-text">
              <div className="logo-title">Ufriends BioSecure</div>
              <div className="logo-sub">Oversight Platform</div>
            </div>
          </div>
        </div>

        <div className="sidebar-badge">
          {connected
            ? <><span style={{ color: 'var(--brand-primary)' }}>●</span> Live Monitoring</>
            : <><span style={{ color: 'var(--text-muted)' }}>○</span> Connecting…</>
          }
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section-label">Navigation</div>
          {NAV_ITEMS.filter(item => !item.adminOnly || user?.role === 'SUPER_ADMIN').map((item) => {
            const isActive = location.pathname === item.path ||
              (item.path !== '/' && location.pathname.startsWith(item.path));
            const badgeCount = item.badgeKey ? badges[item.badgeKey] : item.badge;

            return (
              <div
                key={item.path}
                id={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                className={`nav-item ${isActive ? 'active' : ''}`}
                onClick={() => navigate(item.path)}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
                {badgeCount > 0 && (
                  <span className={`nav-badge ${item.badgeType || ''}`}>{badgeCount}</span>
                )}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="user-card" onClick={handleLogout} title="Click to logout">
            <div className="user-avatar">{getInitials(user?.fullName)}</div>
            <div className="user-info">
              <div className="user-name">{user?.fullName?.split(' (')[0] || 'User'}</div>
              <div className="user-role">{user?.role?.replace(/_/g, ' ')}</div>
            </div>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>→</span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="main-content">
        {children({ liveEvents, connected })}
      </main>
    </div>
  );
}
