import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(form.email, form.password);
      if (!['PARTNER_ADMIN', 'SUPER_AGENT'].includes(user.role)) {
        setError('This portal is for Frontend Partners only. Use the stakeholder portal at port 5173.');
        localStorage.clear();
        return;
      }
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  const DEMO_ACCOUNTS = [
    { label: 'Partner Admin', email: 'admin@accesspoin.ng', pass: 'Partner@1234' },
    { label: 'Super Agent', email: 'superagent@accesspoin.ng', pass: 'SuperAgent@1234' },
  ];

  return (
    <div className="auth-page">
      <div className="auth-bg" />
      <div className="auth-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{ width: 44, height: 44, background: 'linear-gradient(135deg, var(--brand-primary), var(--brand-accent))', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>🏢</div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2 }}>Ufriends BioSecure</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--brand-primary)' }}>Partner Portal</div>
          </div>
        </div>

        <div className="auth-title">Sign In</div>
        <div className="auth-subtitle">For licensed Frontend Partners and Super-Agents</div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="p-email">Email Address</label>
            <input id="p-email" type="email" className="input" placeholder="admin@yourcompany.ng"
              value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="p-password">Password</label>
            <input id="p-password" type="password" className="input" placeholder="••••••••"
              value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required />
          </div>

          {error && (
            <div style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 8, padding: '9px 13px', fontSize: 12, color: '#F87171', marginBottom: 14 }}>
              ⚠️ {error}
            </div>
          )}

          <button id="partner-login-btn" type="submit" className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', padding: '10px', fontSize: 13.5 }} disabled={loading}>
            {loading ? <><span className="spinner" style={{ width: 15, height: 15 }} /> Signing in…</> : '🔐 Sign In'}
          </button>
        </form>

        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Demo Accounts</div>
          {DEMO_ACCOUNTS.map(({ label, email, pass }) => (
            <button key={email} type="button" onClick={() => setForm({ email, password: pass })}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 11, marginBottom: 5, fontFamily: 'inherit', transition: 'border-color 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-brand)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-subtle)'}>
              <span style={{ color: 'var(--text-muted)' }}>{label}</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: 'var(--brand-accent)' }}>{email}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
