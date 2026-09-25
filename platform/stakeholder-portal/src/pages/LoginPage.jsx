import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { login } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(form.email, form.password);
      // Redirect based on role
      if (user.role === 'SUPER_ADMIN' || user.role === 'COMPLIANCE_OFFICER') {
        window.location.href = '/';
      } else {
        setError('Access denied. This portal is for authorized Ufriends BioSecure oversight staff only.');
        localStorage.clear();
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid credentials. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-bg-grid" />
      <div className="auth-bg-glow" />

      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-icon">🛡️</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--brand-primary)', lineHeight: 1.2 }}>
              Ufriends <span style={{ color: 'var(--brand-accent)' }}>BioSecure</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Oversight Portal
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 24 }}>
          <div className="auth-title">Oversight Login</div>
          <div className="auth-subtitle">Authorized oversight personnel only</div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="email">Official Email Address</label>
            <input
              id="email"
              type="email"
              className="input"
              placeholder="name@ufriends.gov"
              value={form.email}
              onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="input"
              placeholder="••••••••"
              value={form.password}
              onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))}
              required
            />
          </div>

          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: 8, padding: '10px 14px', fontSize: 12.5,
              color: '#F87171', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8
            }}>
              ⚠️ {error}
            </div>
          )}

          <button
            id="login-btn"
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', padding: '11px', fontSize: 14, marginTop: 4 }}
            disabled={loading}
          >
            {loading ? <><span className="spinner" style={{ width: 16, height: 16 }} /> Authenticating…</> : '🔐 Sign In to Platform'}
          </button>
        </form>

        <div className="auth-footer">
          <div style={{ padding: '16px 0 0', borderTop: '1px solid var(--border-subtle)', marginTop: 20 }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Demo Credentials
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[
                { label: 'Super Admin', email: 'admin@ufriends.gov', pass: 'Admin@1234' },
                { label: 'Compliance', email: 'compliance@ufriends.gov', pass: 'Comply@1234' },
              ].map(({ label, email, pass }) => (
                <button
                  key={email}
                  type="button"
                  onClick={() => setForm({ email, password: pass })}
                  style={{
                    background: 'var(--bg-input)', border: '1px solid var(--border-subtle)',
                    borderRadius: 6, padding: '6px 10px', cursor: 'pointer',
                    color: 'var(--text-secondary)', fontSize: 11, textAlign: 'left',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    transition: 'border-color 0.15s ease',
                    fontFamily: 'inherit',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-brand)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-subtle)'}
                >
                  <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5, color: 'var(--brand-accent)' }}>{email}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
