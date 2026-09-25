import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

export default function StrikesPage() {
  const { user } = useAuth();
  const [strikes, setStrikes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [resolveNote, setResolveNote] = useState('');
  const [processing, setProcessing] = useState(false);
  const [canUnlockInfo, setCanUnlockInfo] = useState(null);

  const fetch = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/strikes?resolved=false&limit=50');
      setStrikes(data.strikes);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetch(); }, []);

  const openUnlock = async (strike) => {
    setSelected(strike);
    const { data } = await api.get(`/strikes/can-unlock/${strike.agentId}`);
    setCanUnlockInfo(data);
  };

  const handleUnlock = async () => {
    setProcessing(true);
    try {
      await api.patch(`/strikes/${selected.id}/unlock`, { resolveNote });
      setSelected(null);
      setResolveNote('');
      setCanUnlockInfo(null);
      fetch();
    } catch (err) {
      alert(err.response?.data?.error || 'Cannot unlock this strike with your current role');
    } finally {
      setProcessing(false);
    }
  };

  const TRIGGERS = {
    GPS_OUTSIDE_GEOFENCE: '📍', MOCK_GPS_DETECTED: '🛸', HIGH_ENROLLMENT_VELOCITY: '⚡',
    BIOMETRIC_AUTH_FAIL: '👁️', UNUSUAL_HOURS: '🌙', MANUAL_STRIKE: '✋', VPN_DETECTED: '🔒',
  };

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Agent Strikes
          <span className="topbar-subtitle">Active strikes for your agents</span>
        </div>
      </div>
      <div className="page-content">
        {user?.role === 'SUPER_AGENT' && (
          <div className="perm-warning" style={{ marginBottom: 16 }}>
            ⚠️ As Super-Agent: You can unlock Strikes 1–3. Strikes 4–5 require PARTNER_ADMIN or Central Authority approval.
          </div>
        )}
        {user?.role === 'PARTNER_ADMIN' && (
          <div style={{ padding: '10px 14px', background: 'rgba(37,99,235,.08)', border: '1px solid rgba(37,99,235,.25)', borderRadius: 8, fontSize: 12, color: 'var(--brand-accent)', marginBottom: 16 }}>
            ℹ️ As Partner Admin: You can unlock Strikes 1–4. Strike 5 (permanent ban) requires Central Authority.
          </div>
        )}

        <div className="card">
          <div className="card-body no-pad">
            {loading ? <div className="loading-overlay"><div className="spinner" /> Loading strikes…</div> : (
              <table className="data-table">
                <thead>
                  <tr><th>#</th><th>Agent</th><th>Trigger</th><th>Details</th><th>Date</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {strikes.map(s => (
                    <tr key={s.id}>
                      <td><span style={{ fontSize: 18, fontWeight: 800, color: 'var(--status-danger)' }}>#{s.strikeNumber}</span></td>
                      <td>
                        <div className="td-primary" style={{ fontSize: 12 }}>{s.agent?.fullName}</div>
                        <span className={`badge ${s.agent?.licenseStatus?.toLowerCase()}`} style={{ fontSize: 10 }}>{s.agent?.licenseStatus}</span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span>{TRIGGERS[s.trigger] || '⚠️'}</span>
                          <span style={{ fontSize: 11.5 }}>{s.trigger.replace(/_/g, ' ')}</span>
                        </div>
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--text-secondary)', maxWidth: 180 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.details}</div>
                      </td>
                      <td className="td-mono" style={{ fontSize: 10.5 }}>{new Date(s.issuedAt).toLocaleDateString()}</td>
                      <td>
                        <button id={`partner-unlock-${s.id}`} className="btn btn-ghost btn-sm" onClick={() => openUnlock(s)}>
                          🔓 Review
                        </button>
                      </td>
                    </tr>
                  ))}
                  {strikes.length === 0 && (
                    <tr><td colSpan={6}><div className="empty-state"><div className="empty-icon">✅</div><div className="empty-title">No active strikes</div><div className="empty-sub">All your agents are in good standing</div></div></td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {selected && (
        <div className="modal-overlay" onClick={() => { setSelected(null); setResolveNote(''); setCanUnlockInfo(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">🔓 Strike #{selected.strikeNumber} Review</div>
              <button className="modal-close" onClick={() => { setSelected(null); setResolveNote(''); setCanUnlockInfo(null); }}>×</button>
            </div>
            <div className="modal-body">
              <div className="detail-grid" style={{ marginBottom: 16 }}>
                <div className="detail-field"><div className="detail-label">Agent</div><div className="detail-value">{selected.agent?.fullName}</div></div>
                <div className="detail-field"><div className="detail-label">Strike Number</div><div className="detail-value">#{selected.strikeNumber}</div></div>
                <div className="detail-field"><div className="detail-label">Trigger</div><div className="detail-value">{selected.trigger.replace(/_/g, ' ')}</div></div>
                <div className="detail-field"><div className="detail-label">Your Role</div><div className="detail-value">{user?.role?.replace(/_/g, ' ')}</div></div>
              </div>

              {canUnlockInfo && !canUnlockInfo.canUnlock && (
                <div style={{ padding: '12px', background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 8, fontSize: 12, color: '#F87171', marginBottom: 14 }}>
                  ❌ You cannot unlock this strike. Strike #{selected.strikeNumber} for {user?.role === 'SUPER_AGENT' ? 'strike 4+ requires Partner Admin or Central Authority' : 'permanent bans require Central Authority'}.
                </div>
              )}

              {canUnlockInfo?.canUnlock && (
                <div className="form-group">
                  <label className="form-label">Resolution Note *</label>
                  <textarea className="input" style={{ minHeight: 70 }} placeholder="Explain your review findings and why this strike is being cleared…" value={resolveNote} onChange={e => setResolveNote(e.target.value)} />
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => { setSelected(null); setResolveNote(''); setCanUnlockInfo(null); }}>Close</button>
              {canUnlockInfo?.canUnlock && (
                <button id="partner-confirm-unlock-btn" className="btn btn-primary" onClick={handleUnlock} disabled={processing || !resolveNote.trim()}>
                  {processing ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Processing…</> : '🔓 Unlock Strike'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
