import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

// Credenciales validadas en el frontend para evitar problemas de parsing.
// El token se usa para autenticar las llamadas al backend.
const ADMIN_EMAIL = 'admin@admin.com';
const ADMIN_PASS  = 'admin123';
const ADMIN_TOKEN = 'portfolio-admin-secure-v1';

export default function AdminLogin() {
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]     = useState(null);
  const navigate              = useNavigate();

  function handleSubmit(e) {
    e.preventDefault();
    if (email.trim() === ADMIN_EMAIL && password === ADMIN_PASS) {
      localStorage.setItem('admin_token', ADMIN_TOKEN);
      navigate('/admin');
    } else {
      setError('Credenciales incorrectas');
    }
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
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
            placeholder="admin@admin.com"
            className="w-full bg-bg-base border border-bg-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent" />
          <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Contraseña"
            className="w-full bg-bg-base border border-bg-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent" />
          {error && <p className="text-xs text-loss">{error}</p>}
          <button type="submit"
            className="w-full bg-accent hover:bg-accent/90 text-white rounded-lg py-2 text-sm font-medium">
            Entrar
          </button>
        </form>
      </div>
    </div>
  );
}
