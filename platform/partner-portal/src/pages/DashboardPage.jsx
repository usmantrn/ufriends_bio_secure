import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get('/dashboard/stats'), api.get('/dashboard/recent-activity')])
      .then(([s, a]) => { setStats(s.data); setActivity(a.data); })
      .finally(() => setLoading(false));
    const i = setInterval(() => {
      api.get('/dashboard/stats').then(r => setStats(r.data)).catch(() => {});
    }, 30000);
    return () => clearInterval(i);
  }, []);

  const canUnlock = user?.role !== 'SUPER_AGENT' || true; // Super agents can unlock 1-3

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">
          My Dashboard
          <span className="topbar-subtitle">{user?.organization?.name || 'Your Organization'}</span>
        </div>
        <span className={`badge ${user?.role === 'SUPER_AGENT' ? 'info' : 'active'}`}>{user?.role?.replace(/_/g, ' ')}</span>
      </div>
      <div className="page-content">
        {loading ? <div className="loading-overlay"><div className="spinner" /> Loading…</div> : (
          <>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-value accent">{stats?.agents?.active || 0}</div>
                <div className="stat-label">Active Agents</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{stats?.agents?.pending || 0}</div>
                <div className="stat-label">Pending Approval</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{stats?.enrollments?.total?.toLocaleString() || 0}</div>
                <div className="stat-label">Total Enrollments</div>
              </div>
              <div className="stat-card">
                <div className="stat-value" style={{ fontSize: 20 }}>+{stats?.enrollments?.today || 0}</div>
                <div className="stat-label">Enrolled Today</div>
              </div>
              <div className="stat-card">
                <div className="stat-value warning">{stats?.enrollments?.flagged || 0}</div>
                <div className="stat-label">Flagged Records</div>
              </div>
              <div className="stat-card">
                <div className="stat-value danger">{stats?.strikes?.unresolved || 0}</div>
                <div className="stat-label">Active Strikes</div>
              </div>
            </div>

            {user?.role === 'SUPER_AGENT' && (
              <div className="perm-warning">
                ⚠️ As a Super-Agent, you can only unlock Strike 1–3 on your own agents. Strike 4+ requires your Partner Admin or Central Authority.
              </div>
            )}

            <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {/* Recent Enrollments */}
              <div className="card">
                <div className="card-header">
                  <span>📋</span><span className="card-title">Recent Enrollments</span>
                </div>
                <div className="card-body no-pad">
                  <table className="data-table">
                    <thead><tr><th>Citizen</th><th>State</th><th>Agent</th><th>Time</th></tr></thead>
                    <tbody>
                      {(activity?.recentEnrollments || []).map(e => (
                        <tr key={e.id}>
                          <td className="td-primary" style={{ fontSize: 12 }}>{e.fullName}</td>
                          <td style={{ fontSize: 11 }}>{e.stateOfResidence}</td>
                          <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{e.enrolledByAgent?.fullName}</td>
                          <td className="td-mono" style={{ fontSize: 10 }}>{new Date(e.enrolledAt).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Recent Strikes */}
              <div className="card">
                <div className="card-header">
                  <span>⛔</span><span className="card-title">Recent Strikes</span>
                </div>
                <div className="card-body no-pad">
                  <table className="data-table">
                    <thead><tr><th>#</th><th>Agent</th><th>Trigger</th><th>Date</th></tr></thead>
                    <tbody>
                      {(activity?.recentStrikes || []).map(s => (
                        <tr key={s.id}>
                          <td><span className="badge danger">#{s.strikeNumber}</span></td>
                          <td className="td-primary" style={{ fontSize: 12 }}>{s.agent?.fullName}</td>
                          <td style={{ fontSize: 11 }}>{s.trigger.replace(/_/g,' ')}</td>
                          <td className="td-mono" style={{ fontSize: 10 }}>{new Date(s.issuedAt).toLocaleDateString()}</td>
                        </tr>
                      ))}
                      {!activity?.recentStrikes?.length && (
                        <tr><td colSpan={4} style={{ textAlign:'center', color:'var(--text-muted)', padding: 20, fontSize: 12 }}>No recent strikes ✅</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
