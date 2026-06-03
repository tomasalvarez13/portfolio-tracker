import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminLogin } from '../services/api';

export default function AdminLogin() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState(null);
  const [busy, setBusy]         = useState(false);
  const navigate                = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const { token } = await adminLogin({ username, password });
      localStorage.setItem('admin_token', token);
      navigate('/admin');
    } catch (e) {
      setError(e.response?.data?.error || 'Credenciales incorrectas');
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
          <p className="text-xs text-muted mt-1">Portfolio Tracker</p>
        </div>
        <form onSubmit={handleSubmit} className="card p-5 space-y-3">
          <input type="email" required value={username} onChange={e => setUsername(e.target.value)}
            placeholder="admin@admin.com" autoComplete="email"
            className="w-full bg-bg-base border border-bg-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent" />
          <input required type="password" value={password} onChange={e => setPassword(e.target.value)}
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
