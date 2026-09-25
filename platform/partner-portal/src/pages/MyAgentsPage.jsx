import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

export default function MyAgentsPage() {
  const { user } = useAuth();
  const [agents, setAgents] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [showOnboard, setShowOnboard] = useState(false);
  const [form, setForm] = useState({ fullName: '', nin: '', bvn: '', dateOfBirth: '', gender: 'Male', phone: '', email: '', address: '', stateOfOrigin: '', operatingState: '', operatingLGA: '', guarantor1Name: '', guarantor1Nin: '', guarantor1Phone: '', guarantor1Relationship: 'Employer', guarantor1Address: '', guarantor2Name: '', guarantor2Nin: '', guarantor2Phone: '', guarantor2Relationship: 'Family Member', guarantor2Address: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);

  const fetchAgents = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/agents?page=${page}&limit=15`);
      setAgents(data.agents);
      setTotal(data.total);
      setPages(data.pages);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAgents(); }, [page]);

  const handleOnboard = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { data } = await api.post('/agents', {
        fullName: form.fullName, nin: form.nin, bvn: form.bvn,
        dateOfBirth: form.dateOfBirth, gender: form.gender, phone: form.phone,
        email: form.email, address: form.address, stateOfOrigin: form.stateOfOrigin,
        operatingState: form.operatingState, operatingLGA: form.operatingLGA,
        guarantors: [
          { fullName: form.guarantor1Name, nin: form.guarantor1Nin, phone: form.guarantor1Phone, relationship: form.guarantor1Relationship, address: form.guarantor1Address, state: form.operatingState },
          { fullName: form.guarantor2Name, nin: form.guarantor2Nin, phone: form.guarantor2Phone, relationship: form.guarantor2Relationship, address: form.guarantor2Address, state: form.stateOfOrigin },
        ],
      });
      setSubmitResult(data);
      fetchAgents();
    } catch (err) {
      alert(err.response?.data?.error || 'Onboarding failed');
    } finally {
      setSubmitting(false);
    }
  };

  const canOnboard = user?.role === 'PARTNER_ADMIN' || user?.role === 'SUPER_AGENT';

  const STATES = ['Lagos','Abuja (FCT)','Kano','Rivers','Oyo','Anambra','Kaduna','Delta','Kogi','Borno'];

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">My Agents
          <span className="topbar-subtitle">{total} agents under management</span>
        </div>
        {canOnboard && (
          <button id="onboard-agent-btn" className="btn btn-primary" onClick={() => setShowOnboard(true)}>
            + Onboard New Agent
          </button>
        )}
      </div>
      <div className="page-content">
        <div className="card">
          <div className="card-body no-pad">
            {loading ? <div className="loading-overlay"><div className="spinner" /> Loading agents…</div> : (
              <table className="data-table">
                <thead>
                  <tr><th>Agent</th><th>Territory</th><th>Status</th><th>Strikes</th><th>Enrollments</th></tr>
                </thead>
                <tbody>
                  {agents.map(a => (
                    <tr key={a.id}>
                      <td>
                        <div className="td-primary">{a.fullName}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{a.email}</div>
                      </td>
                      <td style={{ fontSize: 11.5 }}>{a.operatingState}, {a.operatingLGA}</td>
                      <td><span className={`badge ${a.licenseStatus.toLowerCase()}`}>{a.licenseStatus}</span></td>
                      <td>
                        <div className="strike-pips">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className={`strike-pip ${i < a.strikeCount ? 'filled' : ''}`} />
                          ))}
                          <span style={{ fontSize: 10.5, color: 'var(--text-muted)', marginLeft: 3 }}>{a.strikeCount}/5</span>
                        </div>
                      </td>
                      <td className="td-mono">{a._count?.enrollments || 0}</td>
                    </tr>
                  ))}
                  {agents.length === 0 && <tr><td colSpan={5}><div className="empty-state"><div className="empty-icon">👥</div><div className="empty-title">No agents yet</div><div className="empty-sub">Onboard your first agent to get started</div></div></td></tr>}
                </tbody>
              </table>
            )}
          </div>
          <div className="pagination">
            <span>{total} agents</span>
            <div className="pagination-controls">
              <button className="btn btn-ghost btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
              <span style={{ padding: '5px 10px', fontSize: 12 }}>{page} / {pages}</span>
              <button className="btn btn-ghost btn-sm" disabled={page === pages} onClick={() => setPage(p => p + 1)}>Next →</button>
            </div>
          </div>
        </div>
      </div>

      {/* Onboarding Modal */}
      {showOnboard && (
        <div className="modal-overlay" onClick={() => { setShowOnboard(false); setSubmitResult(null); }}>
          <div className="modal" style={{ maxWidth: 620 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">👤 Onboard New Agent</div>
              <button className="modal-close" onClick={() => { setShowOnboard(false); setSubmitResult(null); }}>×</button>
            </div>

            {submitResult ? (
              <div className="modal-body">
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Agent Submitted!</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
                    Pending central approval. Share these credentials with the agent:
                  </div>
                  <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-brand)', borderRadius: 10, padding: 16, textAlign: 'left' }}>
                    <div className="detail-grid">
                      <div className="detail-field"><div className="detail-label">License #</div><div className="detail-value" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{submitResult.agent?.licenseNumber}</div></div>
                      <div className="detail-field"><div className="detail-label">Temp Password</div><div className="detail-value" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--brand-accent)' }}>{submitResult.tempPassword}</div></div>
                    </div>
                  </div>
                </div>
                <div className="modal-footer" style={{ padding: 0, border: 'none', marginTop: 16 }}>
                  <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => { setShowOnboard(false); setSubmitResult(null); }}>Close</button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleOnboard}>
                <div className="modal-body">
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand-accent)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Personal Information</div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Full Name *</label><input className="input" required value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} /></div>
                    <div className="form-group"><label className="form-label">Date of Birth *</label><input className="input" type="date" required value={form.dateOfBirth} onChange={e => setForm(f => ({ ...f, dateOfBirth: e.target.value }))} /></div>
                  </div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">NIN *</label><input className="input" placeholder="11-digit NIN" required value={form.nin} onChange={e => setForm(f => ({ ...f, nin: e.target.value }))} /></div>
                    <div className="form-group"><label className="form-label">BVN *</label><input className="input" placeholder="11-digit BVN" required value={form.bvn} onChange={e => setForm(f => ({ ...f, bvn: e.target.value }))} /></div>
                  </div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Email *</label><input className="input" type="email" required value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
                    <div className="form-group"><label className="form-label">Phone *</label><input className="input" placeholder="+234..." required value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
                  </div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Gender</label><select className="select" style={{ width: '100%' }} value={form.gender} onChange={e => setForm(f => ({ ...f, gender: e.target.value }))}><option>Male</option><option>Female</option></select></div>
                    <div className="form-group"><label className="form-label">State of Origin *</label><select className="select" style={{ width: '100%' }} required value={form.stateOfOrigin} onChange={e => setForm(f => ({ ...f, stateOfOrigin: e.target.value }))}><option value="">Select...</option>{STATES.map(s => <option key={s}>{s}</option>)}</select></div>
                  </div>
                  <div className="form-group"><label className="form-label">Address *</label><input className="input" required value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} /></div>

                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand-accent)', margin: '16px 0 12px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Operating Territory</div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">State *</label><select className="select" style={{ width: '100%' }} required value={form.operatingState} onChange={e => setForm(f => ({ ...f, operatingState: e.target.value }))}><option value="">Select...</option>{STATES.map(s => <option key={s}>{s}</option>)}</select></div>
                    <div className="form-group"><label className="form-label">LGA *</label><input className="input" placeholder="e.g. Ikeja" required value={form.operatingLGA} onChange={e => setForm(f => ({ ...f, operatingLGA: e.target.value }))} /></div>
                  </div>

                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand-accent)', margin: '16px 0 12px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Guarantor 1</div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Name *</label><input className="input" required value={form.guarantor1Name} onChange={e => setForm(f => ({ ...f, guarantor1Name: e.target.value }))} /></div>
                    <div className="form-group"><label className="form-label">NIN *</label><input className="input" required value={form.guarantor1Nin} onChange={e => setForm(f => ({ ...f, guarantor1Nin: e.target.value }))} /></div>
                  </div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Phone *</label><input className="input" required value={form.guarantor1Phone} onChange={e => setForm(f => ({ ...f, guarantor1Phone: e.target.value }))} /></div>
                    <div className="form-group"><label className="form-label">Address *</label><input className="input" required value={form.guarantor1Address} onChange={e => setForm(f => ({ ...f, guarantor1Address: e.target.value }))} /></div>
                  </div>

                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand-accent)', margin: '16px 0 12px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Guarantor 2</div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Name *</label><input className="input" required value={form.guarantor2Name} onChange={e => setForm(f => ({ ...f, guarantor2Name: e.target.value }))} /></div>
                    <div className="form-group"><label className="form-label">NIN *</label><input className="input" required value={form.guarantor2Nin} onChange={e => setForm(f => ({ ...f, guarantor2Nin: e.target.value }))} /></div>
                  </div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Phone *</label><input className="input" required value={form.guarantor2Phone} onChange={e => setForm(f => ({ ...f, guarantor2Phone: e.target.value }))} /></div>
                    <div className="form-group"><label className="form-label">Address *</label><input className="input" required value={form.guarantor2Address} onChange={e => setForm(f => ({ ...f, guarantor2Address: e.target.value }))} /></div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-ghost" onClick={() => setShowOnboard(false)}>Cancel</button>
                  <button id="submit-agent-btn" type="submit" className="btn btn-primary" disabled={submitting}>
                    {submitting ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Submitting…</> : '✓ Submit for Approval'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
