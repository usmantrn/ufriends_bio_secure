import { useEffect, useState } from 'react';
import api from '../api/client';

export default function AuditPage() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [filters, setFilters] = useState({ action: '', startDate: '', endDate: '' });

  const fetch = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 25, ...filters });
      Object.keys(filters).forEach(k => !filters[k] && params.delete(k));
      const { data } = await api.get(`/audit?${params}`);
      setLogs(data.logs);
      setTotal(data.total);
      setPages(data.pages);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetch(); }, [page, filters]);

  const ACTION_COLOR = {
    AGENT_BANNED: 'danger', AGENT_SUSPENDED: 'suspended', STRIKE_ISSUED: 'danger',
    CITIZEN_FLAGGED: 'warning', FLAG_ESCALATED: 'escalated', CITIZEN_LOCKED: 'danger',
    AGENT_APPROVED: 'active', ORG_APPROVED: 'active', STRIKE_UNLOCKED: 'medium',
  };

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Audit Trail
          <span className="topbar-subtitle">Immutable system log — {total.toLocaleString()} entries</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--brand-accent)', display: 'flex', alignItems: 'center', gap: 6 }}>
          🔒 Tamper-proof · Append-only
        </div>
      </div>
      <div className="page-content">
        <div className="filters-bar">
          <input
            className="input"
            type="date"
            value={filters.startDate}
            onChange={e => setFilters(f => ({ ...f, startDate: e.target.value }))}
            style={{ width: 160 }}
          />
          <input
            className="input"
            type="date"
            value={filters.endDate}
            onChange={e => setFilters(f => ({ ...f, endDate: e.target.value }))}
            style={{ width: 160 }}
          />
          <input
            className="input"
            placeholder="Filter by action (e.g. AGENT_BANNED)"
            value={filters.action}
            onChange={e => setFilters(f => ({ ...f, action: e.target.value.toUpperCase() }))}
            style={{ width: 280 }}
          />
          <button className="btn btn-ghost btn-sm" onClick={() => setFilters({ action: '', startDate: '', endDate: '' })}>Clear</button>
        </div>

        <div className="card">
          <div className="card-body no-pad">
            {loading ? (
              <div className="loading-overlay"><div className="spinner" /> Loading audit trail…</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Target</th>
                    <th>Description</th>
                    <th>IP Address</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => (
                    <tr key={log.id}>
                      <td className="td-mono" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                        {new Date(log.timestamp).toLocaleString('en-NG', { hour12: false })}
                      </td>
                      <td>
                        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
                          {log.actor?.fullName || 'System'}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{log.actorRole}</div>
                      </td>
                      <td>
                        <span className={`badge ${ACTION_COLOR[log.action] || 'low'}`} style={{ fontSize: 10.5 }}>
                          {log.action.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td style={{ fontSize: 11.5 }}>
                        {log.targetType && <span style={{ color: 'var(--text-muted)' }}>{log.targetType}: </span>}
                        <span className="td-mono" style={{ fontSize: 10 }}>{log.targetId?.slice(0, 12)}…</span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 280 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {log.description}
                        </div>
                      </td>
                      <td className="td-mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{log.ipAddress || '—'}</td>
                    </tr>
                  ))}
                  {logs.length === 0 && (
                    <tr><td colSpan={6}><div className="empty-state"><div className="empty-icon">📜</div><div className="empty-title">No audit logs match filters</div></div></td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
          <div className="pagination">
            <span>{total.toLocaleString()} log entries</span>
            <div className="pagination-controls">
              <button className="btn btn-ghost btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
              <span style={{ padding: '5px 10px', fontSize: 12 }}>{page} / {pages}</span>
              <button className="btn btn-ghost btn-sm" disabled={page === pages} onClick={() => setPage(p => p + 1)}>Next →</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
