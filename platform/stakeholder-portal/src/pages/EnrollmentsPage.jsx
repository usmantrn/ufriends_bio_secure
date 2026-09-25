import { useEffect, useState } from 'react';
import api from '../api/client';

export default function EnrollmentsPage() {
  const [enrollments, setEnrollments] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [filters, setFilters] = useState({ flagged: '', state: '' });

  const fetch = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 20, ...filters });
      Object.keys(filters).forEach(k => !filters[k] && params.delete(k));
      const { data } = await api.get(`/enrollments?${params}`);
      setEnrollments(data.enrollments);
      setTotal(data.total);
      setPages(data.pages);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetch(); }, [page, filters]);

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Enrollment Records
          <span className="topbar-subtitle">{total.toLocaleString()} citizens enrolled</span>
        </div>
      </div>
      <div className="page-content">
        <div className="filters-bar">
          <select className="select" value={filters.flagged} onChange={e => setFilters(f => ({ ...f, flagged: e.target.value }))}>
            <option value="">All Records</option>
            <option value="true">Flagged Only</option>
          </select>
        </div>

        <div className="card">
          <div className="card-body no-pad">
            {loading ? (
              <div className="loading-overlay"><div className="spinner" /> Loading enrollments…</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Citizen Name</th>
                    <th>State / LGA</th>
                    <th>Enrolled By</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th>GPS Integrity</th>
                  </tr>
                </thead>
                <tbody>
                  {enrollments.map(e => (
                    <tr key={e.id}>
                      <td className="td-primary">{e.fullName}</td>
                      <td style={{ fontSize: 12 }}>{e.stateOfResidence}, {e.lgaOfResidence}</td>
                      <td style={{ fontSize: 12 }}>{e.enrolledByAgent?.fullName}</td>
                      <td className="td-mono" style={{ fontSize: 11 }}>{new Date(e.enrolledAt).toLocaleDateString()}</td>
                      <td>
                        {e.flaggedForReview
                          ? <span className="badge flagged">⚠️ Flagged</span>
                          : <span className="badge active">✓ Clean</span>
                        }
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {e.mockGpsDetected && <span className="badge danger" style={{ fontSize: 10 }}>Mock GPS</span>}
                          {e.vpnDetected && <span className="badge warning" style={{ fontSize: 10 }}>VPN</span>}
                          {!e.mockGpsDetected && !e.vpnDetected && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Clean</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {enrollments.length === 0 && (
                    <tr><td colSpan={6}><div className="empty-state"><div className="empty-icon">📋</div><div className="empty-title">No enrollments found</div></div></td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
          <div className="pagination">
            <span>{total.toLocaleString()} enrollments</span>
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
