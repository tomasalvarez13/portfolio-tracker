import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth.jsx';
import { usePrivacy } from './hooks/usePrivacy.js';
import { initPrivacy } from './utils/privacy.js';
import Layout from './components/layout/Layout.jsx';
import Login from './pages/Login.jsx';
import Posiciones from './pages/Posiciones.jsx';
import Resumen from './pages/Resumen.jsx';
import Rentabilidad from './pages/Rentabilidad.jsx';
import Analisis from './pages/Analisis.jsx';
import Mercado from './pages/Mercado.jsx';
import Movimientos from './pages/Movimientos.jsx';
import Chat from './pages/Chat.jsx';
import AdminLogin from './pages/AdminLogin.jsx';
import AdminDashboard from './pages/AdminDashboard.jsx';
import Landing from './pages/Landing.jsx';
import Demo from './pages/Demo.jsx';
import DemoBadge from './components/DemoBadge.jsx';

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
  const { user } = useAuth();

  // La suscripción va acá y no en el Layout: <Outlet/> devuelve el mismo objeto
  // de elemento que se crea abajo, así que re-renderizar el Layout no alcanza —
  // React se saltea el subárbol. Al re-renderizar App, los <Resumen/> y compañía
  // se crean de nuevo y las páginas sí vuelven a formatear sus números.
  usePrivacy();
  useEffect(() => { initPrivacy(user?.id); }, [user?.id]);

  return (
    <>
    <DemoBadge />
    <Routes>
      <Route path="/"      element={<Landing />} />
      <Route path="/login" element={<Login />} />
      {/* Modo demo: prende el flag y reusa el mismo árbol /app/* */}
      <Route path="/demo"  element={<Demo />} />
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
        <Route path="analisis"     element={<Analisis />} />
        <Route path="mercado"      element={<Mercado />} />
        <Route path="chat"         element={<Chat />} />
      </Route>
      {/* Admin — sistema de auth propio, fuera del ProtectedRoute de Supabase */}
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin"       element={<AdminDashboard />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  );
}
