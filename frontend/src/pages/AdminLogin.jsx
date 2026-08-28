import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';

// Login del panel admin. Usa la cuenta normal de Supabase; el permiso lo decide
// el rol 'admin' en public.users, que valida el backend. Antes las credenciales
// estaban escritas en este archivo, en un repo público.
export default function AdminLogin() {
  const { session, signIn } = useAuth();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState(null);
  const [busy, setBusy]         = useState(false);
  const navigate                = useNavigate();

  if (session) return <Navigate to="/admin" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      const { error: err } = await signIn(email.trim(), password);
      if (err) throw err;
      navigate('/admin');
    } catch (err) {
      const msg = err.message || '';
      setError(msg.includes('Invalid login credentials')
        ? 'Email o contraseña incorrectos.'
        : msg || 'Error de autenticación');
    } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="w-full max-w-xs">
        <div className="text-center mb-6">
          <div className="w-10 h-10 bg-accent/15 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <span className="text-accent text-lg">⚙</span>
          </div>
          <h1 className="text-lg font-semibold">Panel de administración</h1>
          <p className="text-xs text-muted mt-1">Entrá con tu cuenta de administrador</p>
        </div>
        <form onSubmit={handleSubmit} className="card p-5 space-y-3">
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
            placeholder="tu@correo.com" autoComplete="username"
            className="w-full bg-bg-base border border-bg-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent" />
          <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Contraseña" autoComplete="current-password"
            className="w-full bg-bg-base border border-bg-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent" />
          {error && <p className="text-xs text-loss">{error}</p>}
          <button type="submit" disabled={busy}
            className="w-full bg-accent hover:bg-accent/90 disabled:opacity-50 text-white rounded-lg py-2 text-sm font-medium">
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
