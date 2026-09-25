import { useEffect, useState } from 'react';
import api from '../api/client';

const SEVERITY_BADGE = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };
const STATUS_BADGE = { OPEN: 'open', UNDER_REVIEW: 'warning', RESOLVED: 'resolved', ESCALATED: 'escalated' };
const FLAG_ICONS = {
  ENROLLMENT_SPEED: '⚡', TIME_PATTERN: '🕒', DEMOGRAPHIC_CLUSTER: '📍',
  DUPLICATE_FACE: '👤', CROSS_AGENT_DEVICE: '📱', LOCATION_ANOMALY: '🌐', BULK_SIMILAR_FACES: '👥',
};

export default function FlagsPage() {
  const [flags, setFlags] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: 'OPEN', severity: '', flagType: '' });
  const [selected, setSelected] = useState(null);
  const [resolveNote, setResolveNote] = useState('');
  const [processing, setProcessing] = useState(false);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [summary, setSummary] = useState(null);

  const fetch = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 15, ...filters });
      Object.keys(filters).forEach(k => !filters[k] && params.delete(k));
      const [flagsRes, summaryRes] = await Promise.all([
        api.get(`/flags?${params}`),
        api.get('/flags/summary'),
      ]);
      setFlags(flagsRes.data.flags);
      setTotal(flagsRes.data.total);
      setPages(flagsRes.data.pages);
      setSummary(summaryRes.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetch(); }, [page, filters]);

  const handleResolve = async (escalate = false) => {
    setProcessing(true);
    try {
      await api.patch(`/flags/${selected.id}/resolve`, { resolveNote, escalate });
      setSelected(null);
      setResolveNote('');
      fetch();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Flags & Behavioral Alerts
          <span className="topbar-subtitle">{total} matching flags</span>
        </div>
      </div>
      <div className="page-content">
        {/* Summary Cards */}
        {summary && (
          <div className="stats-grid" style={{ marginBottom: 20 }}>
            {(summary.byStatus || []).map(s => (
              <div key={s.status} className="stat-card">
                <div className="stat-value" style={{ fontSize: 22 }}>{s._count.id}</div>
                <div className="stat-label">{s.status.replace(/_/g, ' ')}</div>
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="filters-bar" style={{ marginBottom: 16 }}>
          {['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'ESCALATED', ''].map(s => (
            <button
              key={s || 'all'}
              id={`filter-${s || 'all'}`}
              className={`btn btn-sm ${filters.status === s ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFilters(f => ({ ...f, status: s }))}
            >
              {s || 'All'}
            </button>
          ))}
          <select className="select" value={filters.severity} onChange={e => setFilters(f => ({ ...f, severity: e.target.value }))}>
            <option value="">All Severity</option>
            {['CRITICAL','HIGH','MEDIUM','LOW'].map(s => <option key={s}>{s}</option>)}
          </select>
          <select className="select" value={filters.flagType} onChange={e => setFilters(f => ({ ...f, flagType: e.target.value }))}>
            <option value="">All Types</option>
            {Object.keys(FLAG_ICONS).map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
        </div>

        <div className="card">
          <div className="card-body no-pad">
            {loading ? (
              <div className="loading-overlay"><div className="spinner" /> Loading flags…</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Agent</th>
                    <th>Organization</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th>Raised</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {flags.map(flag => (
                    <tr key={flag.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 18 }}>{FLAG_ICONS[flag.flagType] || '🚩'}</span>
                          <div>
                            <div className="td-primary" style={{ fontSize: 12 }}>{flag.flagType.replace(/_/g, ' ')}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {flag.description}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="td-primary" style={{ fontSize: 12 }}>{flag.agent?.fullName}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{flag.agent?.licenseNumber?.slice(0,10)}…</div>
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{flag.agent?.organization?.name}</td>
                      <td><span className={`badge ${SEVERITY_BADGE[flag.severity]}`}>{flag.severity}</span></td>
                      <td><span className={`badge ${STATUS_BADGE[flag.status]}`}>{flag.status.replace('_', ' ')}</span></td>
                      <td className="td-mono" style={{ fontSize: 11 }}>{new Date(flag.raisedAt).toLocaleDateString()}</td>
                      <td className="td-action">
                        <button
                          id={`review-flag-${flag.id}`}
                          className="btn btn-ghost btn-sm"
                          onClick={() => setSelected(flag)}
                        >Review</button>
                      </td>
                    </tr>
                  ))}
                  {flags.length === 0 && (
                    <tr><td colSpan={7}><div className="empty-state"><div className="empty-icon">✅</div><div className="empty-title">No flags match the current filters</div></div></td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
          <div className="pagination">
            <span>{total} flags total</span>
            <div className="pagination-controls">
              <button className="btn btn-ghost btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
              <span style={{ padding: '5px 10px', fontSize: 12 }}>{page} / {pages}</span>
              <button className="btn btn-ghost btn-sm" disabled={page === pages} onClick={() => setPage(p => p + 1)}>Next →</button>
            </div>
          </div>
        </div>
      </div>

      {/* Review Modal */}
      {selected && (
        <div className="modal-overlay" onClick={() => { setSelected(null); setResolveNote(''); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">{FLAG_ICONS[selected.flagType]} Flag Review</div>
              <button className="modal-close" onClick={() => { setSelected(null); setResolveNote(''); }}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
                <div className="detail-grid">
                  <div className="detail-field"><div className="detail-label">Flag Type</div><div className="detail-value">{selected.flagType.replace(/_/g,' ')}</div></div>
                  <div className="detail-field"><div className="detail-label">Severity</div><div className="detail-value"><span className={`badge ${SEVERITY_BADGE[selected.severity]}`}>{selected.severity}</span></div></div>
                  <div className="detail-field"><div className="detail-label">Agent</div><div className="detail-value">{selected.agent?.fullName}</div></div>
                  <div className="detail-field"><div className="detail-label">Raised</div><div className="detail-value">{new Date(selected.raisedAt).toLocaleString()}</div></div>
                </div>
                <div style={{ padding: '12px', background: 'var(--bg-surface)', borderRadius: 8, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  {selected.description}
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Review Note <span style={{ color: 'var(--status-danger)' }}>*</span></label>
                <textarea
                  className="input"
                  style={{ minHeight: 80, resize: 'vertical' }}
                  placeholder="Document your investigation findings and decision…"
                  value={resolveNote}
                  onChange={e => setResolveNote(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => { setSelected(null); setResolveNote(''); }}>Cancel</button>
              <button
                id="escalate-flag-btn"
                className="btn btn-danger"
                onClick={() => handleResolve(true)}
                disabled={processing || !resolveNote.trim()}
              >
                ↑ Escalate
              </button>
              <button
                id="resolve-flag-btn"
                className="btn btn-primary"
                onClick={() => handleResolve(false)}
                disabled={processing || !resolveNote.trim()}
              >
                {processing ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Processing…</> : '✓ Resolve'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
