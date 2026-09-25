import { useEffect, useState } from 'react';
import api from '../api/client';

export default function OrganizationsPage() {
  const [orgs, setOrgs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetch = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/organizations?limit=50');
      setOrgs(data.organizations);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetch(); }, []);

  const handleApprove = async (id) => {
    await api.patch(`/organizations/${id}/approve`);
    fetch();
  };

  const handleSuspend = async (id) => {
    if (!confirm('Suspend this organization?')) return;
    await api.patch(`/organizations/${id}/suspend`);
    fetch();
  };

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Frontend Partner Organizations
          <span className="topbar-subtitle">{total} registered companies</span>
        </div>
      </div>
      <div className="page-content">
        <div className="card">
          <div className="card-body no-pad">
            {loading ? <div className="loading-overlay"><div className="spinner" /> Loading…</div> : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Organization</th>
                    <th>RC Number</th>
                    <th>State</th>
                    <th>Director</th>
                    <th>Agents</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orgs.map(org => (
                    <tr key={org.id}>
                      <td>
                        <div className="td-primary">{org.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{org.contactEmail}</div>
                      </td>
                      <td className="td-mono">{org.rcNumber}</td>
                      <td style={{ fontSize: 12 }}>{org.state}</td>
                      <td style={{ fontSize: 12 }}>{org.directorName}</td>
                      <td className="td-mono">{org._count?.agents || 0}</td>
                      <td>
                        <span className={`badge ${org.status === 'ACTIVE' ? 'active' : org.status === 'PENDING' ? 'pending' : 'suspended'}`}>
                          {org.status}
                        </span>
                      </td>
                      <td className="td-action">
                        <div style={{ display: 'flex', gap: 6 }}>
                          {org.status === 'PENDING' && (
                            <button id={`approve-org-${org.id}`} className="btn btn-primary btn-sm" onClick={() => handleApprove(org.id)}>Approve</button>
                          )}
                          {org.status === 'ACTIVE' && (
                            <button id={`suspend-org-${org.id}`} className="btn btn-danger btn-sm" onClick={() => handleSuspend(org.id)}>Suspend</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
