import { useEffect, useState } from 'react';
import api from '../api/client';

export default function StrikesPage() {
  const [strikes, setStrikes] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [filters, setFilters] = useState({ resolved: 'false' });
  const [unlocking, setUnlocking] = useState(null);
  const [resolveNote, setResolveNote] = useState('');
  const [processing, setProcessing] = useState(false);

  const fetch = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 20, ...filters });
      const { data } = await api.get(`/strikes?${params}`);
      setStrikes(data.strikes);
      setTotal(data.total);
      setPages(data.pages);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetch(); }, [page, filters]);

  const handleUnlock = async () => {
    setProcessing(true);
    try {
      await api.patch(`/strikes/${unlocking.id}/unlock`, { resolveNote });
      setUnlocking(null);
      setResolveNote('');
      fetch();
    } catch (err) {
      alert(err.response?.data?.error || 'Cannot unlock this strike');
    } finally {
      setProcessing(false);
    }
  };

  const TRIGGER_ICONS = {
    GPS_OUTSIDE_GEOFENCE: '📍', MOCK_GPS_DETECTED: '🛸', VPN_DETECTED: '🔒',
    HIGH_ENROLLMENT_VELOCITY: '⚡', BIOMETRIC_AUTH_FAIL: '👁️', UNUSUAL_HOURS: '🌙',
    MANUAL_STRIKE: '✋', TIME_MANIPULATION: '⏰', IMPOSSIBLE_TRAVEL: '🚀',
  };

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Strike Management
          <span className="topbar-subtitle">{total} strikes</span>
        </div>
      </div>
      <div className="page-content">
        <div className="filters-bar">
          {[['false','Unresolved'],['true','Resolved'],['','All']].map(([val, label]) => (
            <button key={val} className={`btn btn-sm ${filters.resolved === val ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFilters(f => ({ ...f, resolved: val }))}>{label}</button>
          ))}
        </div>
        <div className="card">
          <div className="card-body no-pad">
            {loading ? <div className="loading-overlay"><div className="spinner" /> Loading strikes…</div> : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Strike #</th>
                    <th>Agent</th>
                    <th>Trigger</th>
                    <th>Details</th>
                    <th>Status</th>
                    <th>Issued</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {strikes.map(strike => (
                    <tr key={strike.id}>
                      <td>
                        <span style={{ fontSize: 20, fontWeight: 800, color: strike.isResolved ? 'var(--text-muted)' : 'var(--status-danger)' }}>
                          #{strike.strikeNumber}
                        </span>
                      </td>
                      <td>
                        <div className="td-primary" style={{ fontSize: 12 }}>{strike.agent?.fullName}</div>
                        <span className={`badge ${strike.agent?.licenseStatus?.toLowerCase()}`} style={{ fontSize: 10 }}>{strike.agent?.licenseStatus}</span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 16 }}>{TRIGGER_ICONS[strike.trigger] || '⚠️'}</span>
                          <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{strike.trigger.replace(/_/g, ' ')}</span>
                        </div>
                      </td>
                      <td style={{ fontSize: 11.5, color: 'var(--text-secondary)', maxWidth: 200 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{strike.details}</div>
                      </td>
                      <td>
                        {strike.isResolved
                          ? <span className="badge resolved">✓ Resolved</span>
                          : <span className="badge danger">● Active</span>}
                      </td>
                      <td className="td-mono" style={{ fontSize: 11 }}>{new Date(strike.issuedAt).toLocaleDateString()}</td>
                      <td>
                        {!strike.isResolved && (
                          <button id={`unlock-strike-${strike.id}`} className="btn btn-ghost btn-sm" onClick={() => setUnlocking(strike)}>
                            🔓 Unlock
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {strikes.length === 0 && (
                    <tr><td colSpan={7}><div className="empty-state"><div className="empty-icon">✅</div><div className="empty-title">No strikes in this view</div></div></td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
          <div className="pagination">
            <span>{total} strikes</span>
            <div className="pagination-controls">
              <button className="btn btn-ghost btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
              <span style={{ padding: '5px 10px', fontSize: 12 }}>{page} / {pages}</span>
              <button className="btn btn-ghost btn-sm" disabled={page === pages} onClick={() => setPage(p => p + 1)}>Next →</button>
            </div>
          </div>
        </div>
      </div>

      {unlocking && (
        <div className="modal-overlay" onClick={() => { setUnlocking(null); setResolveNote(''); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">🔓 Unlock Strike #{unlocking.strikeNumber}</div>
              <button className="modal-close" onClick={() => { setUnlocking(null); setResolveNote(''); }}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ padding: '12px', background: 'var(--bg-surface)', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
                <strong>{unlocking.agent?.fullName}</strong> · Strike #{unlocking.strikeNumber}
                <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>{unlocking.trigger.replace(/_/g, ' ')}: {unlocking.details}</div>
              </div>
              <div className="form-group">
                <label className="form-label">Resolution Note *</label>
                <textarea className="input" style={{ minHeight: 80 }} placeholder="Explain why this strike is being unlocked…"
                  value={resolveNote} onChange={e => setResolveNote(e.target.value)} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => { setUnlocking(null); setResolveNote(''); }}>Cancel</button>
              <button id="confirm-unlock-btn" className="btn btn-primary" onClick={handleUnlock}
                disabled={processing || !resolveNote.trim()}>
                {processing ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Processing…</> : '🔓 Confirm Unlock'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
