import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth.jsx';
import Layout from './components/layout/Layout.jsx';
import Login from './pages/Login.jsx';
import Posiciones from './pages/Posiciones.jsx';
import Resumen from './pages/Resumen.jsx';
import Rentabilidad from './pages/Rentabilidad.jsx';
import Mercado from './pages/Mercado.jsx';
import Movimientos from './pages/Movimientos.jsx';
import Chat from './pages/Chat.jsx';
import AdminLogin from './pages/AdminLogin.jsx';
import AdminDashboard from './pages/AdminDashboard.jsx';
import Landing from './pages/Landing.jsx';

function ProtectedRoute({ children }) {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="h-screen grid place-items-center text-muted">Cargando…</div>
    );
  }
  if (!session) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/"      element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/app/resumen" replace />} />
        <Route path="resumen"      element={<Resumen />} />
        <Route path="posiciones"   element={<Posiciones />} />
        <Route path="movimientos"  element={<Movimientos />} />
        <Route path="rentabilidad" element={<Rentabilidad />} />
        <Route path="mercado"      element={<Mercado />} />
        <Route path="chat"         element={<Chat />} />
      </Route>
      {/* Admin — sistema de auth propio, fuera del ProtectedRoute de Supabase */}
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin"       element={<AdminDashboard />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
