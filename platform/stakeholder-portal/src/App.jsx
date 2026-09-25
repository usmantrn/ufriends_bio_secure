import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import AppShell from './components/AppShell';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import AgentsPage from './pages/AgentsPage';
import FlagsPage from './pages/FlagsPage';
import AuditPage from './pages/AuditPage';
import EnrollmentsPage from './pages/EnrollmentsPage';
import StrikesPage from './pages/StrikesPage';
import OrganizationsPage from './pages/OrganizationsPage';

function ProtectedRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 12, color: 'var(--text-muted)' }}>
        <div className="spinner" />
        <span style={{ fontSize: 14 }}>Loading platform…</span>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  return (
    <AppShell>
      {({ liveEvents, connected }) => (
        <Routes>
          <Route path="/" element={<DashboardPage liveEvents={liveEvents} connected={connected} />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/organizations" element={<OrganizationsPage />} />
          <Route path="/enrollments" element={<EnrollmentsPage />} />
          <Route path="/flags" element={<FlagsPage />} />
          <Route path="/strikes" element={<StrikesPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </AppShell>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/*" element={<ProtectedRoutes />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
