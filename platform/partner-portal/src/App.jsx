import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import AppShell from './components/AppShell';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import MyAgentsPage from './pages/MyAgentsPage';
import StrikesPage from './pages/StrikesPage';
import EnrollmentsPage from './pages/EnrollmentsPage';
import ProfilePage from './pages/ProfilePage';

function ProtectedRoutes() {
  const { user, loading } = useAuth();
  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', gap:12, color:'var(--text-muted)' }}>
      <div className="spinner" /> Loading partner portal…
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  // Only partner roles allowed
  if (!['PARTNER_ADMIN','SUPER_AGENT'].includes(user.role)) {
    localStorage.clear();
    return <Navigate to="/login" replace />;
  }
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/agents" element={<MyAgentsPage />} />
        <Route path="/enrollments" element={<EnrollmentsPage />} />
        <Route path="/strikes" element={<StrikesPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
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
