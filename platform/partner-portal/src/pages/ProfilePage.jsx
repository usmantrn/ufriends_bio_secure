import { useAuth } from '../context/AuthContext';

export default function ProfilePage() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <>
      <div className="topbar"><div className="topbar-title">My Profile</div></div>
      <div className="page-content">
        <div className="card" style={{ maxWidth: 560 }}>
          <div className="card-header">
            <div style={{ width: 44, height: 44, borderRadius: 50, background: 'linear-gradient(135deg, var(--brand-primary), var(--brand-accent))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16, color: 'white' }}>
              {user.fullName?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="card-title">{user.fullName?.split(' (')[0]}</div>
              <span className={`badge ${user.role === 'PARTNER_ADMIN' ? 'active' : 'info'}`}>{user.role?.replace(/_/g, ' ')}</span>
            </div>
          </div>
          <div className="card-body">
            <div className="detail-grid">
              <div className="detail-field"><div className="detail-label">Email</div><div className="detail-value">{user.email}</div></div>
              <div className="detail-field"><div className="detail-label">Phone</div><div className="detail-value">{user.phone || '—'}</div></div>
              <div className="detail-field"><div className="detail-label">Organization</div><div className="detail-value">{user.organization?.name || '—'}</div></div>
              <div className="detail-field"><div className="detail-label">Role</div><div className="detail-value">{user.role?.replace(/_/g, ' ')}</div></div>
            </div>

            {user.organization && (
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 10 }}>Organization Details</div>
                <div className="detail-grid">
                  <div className="detail-field"><div className="detail-label">RC Number</div><div className="detail-value" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>{user.organization?.rcNumber || '—'}</div></div>
                  <div className="detail-field"><div className="detail-label">Status</div><div className="detail-value"><span className={`badge ${user.organization?.status?.toLowerCase() || 'active'}`}>{user.organization?.status}</span></div></div>
                  <div className="detail-field"><div className="detail-label">State</div><div className="detail-value">{user.organization?.state || '—'}</div></div>
                  <div className="detail-field"><div className="detail-label">Contact</div><div className="detail-value">{user.organization?.contactEmail || '—'}</div></div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
