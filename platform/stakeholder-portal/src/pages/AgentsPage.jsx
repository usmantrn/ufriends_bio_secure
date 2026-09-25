import { useEffect, useState } from 'react';
import api from '../api/client';

const STATUS_COLORS = { ACTIVE: 'active', PENDING: 'pending', SUSPENDED: 'suspended', BANNED: 'banned' };
const NIGERIAN_STATES = ['Lagos','Abuja (FCT)','Kano','Rivers','Oyo','Anambra','Kaduna','Delta','Kogi','Borno','Sokoto','Imo'];

function StrikePips({ count, status }) {
  const max = 5;
  return (
    <div className="strike-timeline">
      {Array.from({ length: max }).map((_, i) => (
        <div key={i} className={`strike-pip ${i < count ? (status === 'BANNED' ? 'banned' : status === 'SUSPENDED' ? 'suspended' : 'filled') : ''}`} />
      ))}
      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>{count}/5</span>
    </div>
  );
}

export default function AgentsPage() {
  const [agents, setAgents] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ search: '', status: '', state: '' });
  const [selected, setSelected] = useState(null);
  const [actionModal, setActionModal] = useState(null);
  const [actionReason, setActionReason] = useState('');
  const [processing, setProcessing] = useState(false);

  const fetchAgents = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 15, ...filters });
      Object.keys(filters).forEach(k => !filters[k] && params.delete(k));
      const { data } = await api.get(`/agents?${params}`);
      setAgents(data.agents);
      setTotal(data.total);
      setPages(data.pages);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAgents(); }, [page, filters]);

  const handleAction = async (action) => {
    setProcessing(true);
    try {
      await api.patch(`/agents/${selected.id}/${action}`, { reason: actionReason });
      setActionModal(null);
      setActionReason('');
      setSelected(null);
      fetchAgents();
    } catch (err) {
      alert(err.response?.data?.error || 'Action failed');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Agent Management
          <span className="topbar-subtitle">{total.toLocaleString()} agents registered</span>
        </div>
      </div>
      <div className="page-content">
        {/* Filters */}
        <div className="filters-bar">
          <div className="search-input-wrapper">
            <span className="search-icon">🔍</span>
            <input
              id="agent-search"
              className="input"
              placeholder="Search name, NIN, license…"
              value={filters.search}
              onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
            />
          </div>
          <select id="filter-status" className="select" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
            <option value="">All Status</option>
            {['ACTIVE','PENDING','SUSPENDED','BANNED'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select id="filter-state" className="select" value={filters.state} onChange={e => setFilters(f => ({ ...f, state: e.target.value }))}>
            <option value="">All States</option>
            {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="card">
          <div className="card-body no-pad">
            {loading ? (
              <div className="loading-overlay"><div className="spinner" /> Loading agents…</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>License #</th>
                    <th>Organization</th>
                    <th>Territory</th>
                    <th>Status</th>
                    <th>Strikes</th>
                    <th>Enrollments</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map(agent => (
                    <tr key={agent.id}>
                      <td>
                        <div className="td-primary">{agent.fullName}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{agent.email}</div>
                      </td>
                      <td className="td-mono">{agent.licenseNumber.slice(0, 12)}…</td>
                      <td style={{ fontSize: 12 }}>{agent.organization?.name || '—'}</td>
                      <td style={{ fontSize: 12 }}>{agent.operatingState}, {agent.operatingLGA}</td>
                      <td><span className={`badge ${STATUS_COLORS[agent.licenseStatus]}`}>{agent.licenseStatus}</span></td>
                      <td>
                        <StrikePips count={agent.strikeCount} status={agent.licenseStatus} />
                      </td>
                      <td className="td-mono">{agent._count?.enrollments || 0}</td>
                      <td className="td-action">
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            id={`view-agent-${agent.id}`}
                            className="btn btn-ghost btn-sm"
                            onClick={() => setSelected(agent)}
                          >View</button>
                          {agent.licenseStatus === 'PENDING' && (
                            <button className="btn btn-primary btn-sm" onClick={() => { setSelected(agent); setActionModal('approve'); }}>Approve</button>
                          )}
                          {agent.licenseStatus === 'ACTIVE' && (
                            <button className="btn btn-danger btn-sm" onClick={() => { setSelected(agent); setActionModal('suspend'); }}>Suspend</button>
                          )}
                          {agent.licenseStatus !== 'BANNED' && (
                            <button className="btn btn-danger btn-sm" style={{ background: 'rgba(220,38,38,0.2)' }} onClick={() => { setSelected(agent); setActionModal('ban'); }}>Ban</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {agents.length === 0 && (
                    <tr><td colSpan={8}><div className="empty-state"><div className="empty-icon">🔍</div><div className="empty-title">No agents found</div></div></td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          <div className="pagination">
            <span>{total} agents total</span>
            <div className="pagination-controls">
              <button className="btn btn-ghost btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
              <span style={{ padding: '5px 10px', fontSize: 12, color: 'var(--text-secondary)' }}>{page} / {pages}</span>
              <button className="btn btn-ghost btn-sm" disabled={page === pages} onClick={() => setPage(p => p + 1)}>Next →</button>
            </div>
          </div>
        </div>
      </div>

      {/* Action Modal */}
      {actionModal && selected && (
        <div className="modal-overlay" onClick={() => { setActionModal(null); setActionReason(''); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                {actionModal === 'approve' ? '✅ Approve Agent' :
                 actionModal === 'suspend' ? '⚠️ Suspend Agent' : '🚫 Permanently Ban Agent'}
              </div>
              <button className="modal-close" onClick={() => { setActionModal(null); setActionReason(''); }}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ padding: '12px 16px', background: 'var(--bg-surface)', borderRadius: 8, marginBottom: 16 }}>
                <div className="td-primary" style={{ fontWeight: 700, marginBottom: 4 }}>{selected.fullName}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  License: {selected.licenseNumber} · {selected.operatingState}
                </div>
              </div>

              {actionModal !== 'approve' && (
                <div className="form-group">
                  <label className="form-label">Reason for {actionModal} <span style={{ color: 'var(--status-danger)' }}>*</span></label>
                  <textarea
                    className="input"
                    style={{ minHeight: 80, resize: 'vertical' }}
                    placeholder={actionModal === 'ban' ? 'Detail the fraud evidence and investigation findings…' : 'Provide reason for suspension…'}
                    value={actionReason}
                    onChange={e => setActionReason(e.target.value)}
                  />
                </div>
              )}

              {actionModal === 'ban' && (
                <div style={{ padding: '10px 14px', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)', borderRadius: 8, fontSize: 12.5, color: '#F87171' }}>
                  ⚠️ This action is irreversible. The agent's biometric will be flagged system-wide. All their enrollments will be marked for review.
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => { setActionModal(null); setActionReason(''); }}>Cancel</button>
              <button
                id={`confirm-${actionModal}-btn`}
                className={`btn ${actionModal === 'approve' ? 'btn-primary' : 'btn-danger'}`}
                onClick={() => handleAction(actionModal)}
                disabled={processing || (actionModal !== 'approve' && !actionReason.trim())}
              >
                {processing ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Processing…</> :
                  actionModal === 'approve' ? 'Approve Agent' :
                  actionModal === 'suspend' ? 'Suspend Agent' : 'Permanently Ban Agent'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
