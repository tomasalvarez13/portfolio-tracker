import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';

export default function Login() {
  const { session, signIn, signUp } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to="/" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null); setInfo(null); setBusy(true);
    try {
      if (mode === 'login') {
        const { error } = await signIn(email, password);
        if (error) throw error;
      } else {
        const { error } = await signUp(email, password, name);
        if (error) throw error;
        setInfo('Cuenta creada. Revisa tu correo si se requiere confirmación, luego inicia sesión.');
        setMode('login');
      }
    } catch (err) {
      setError(err.message || 'Error de autenticación');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold">Portfolio Tracker</h1>
          <p className="text-sm text-muted mt-1">Tu portafolio de inversiones</p>
        </div>

        <form onSubmit={handleSubmit} className="card p-6 space-y-4">
          <div className="flex gap-2 text-sm">
            <button type="button" onClick={() => setMode('login')}
              className={`flex-1 py-2 rounded-lg ${mode === 'login' ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-bg-hover'}`}>
              Iniciar sesión
            </button>
            <button type="button" onClick={() => setMode('signup')}
              className={`flex-1 py-2 rounded-lg ${mode === 'signup' ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-bg-hover'}`}>
              Crear cuenta
            </button>
          </div>

          {mode === 'signup' && (
            <input className="w-full bg-bg-base border border-bg-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
              placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} />
          )}
          <input type="email" required className="w-full bg-bg-base border border-bg-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
            placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input type="password" required className="w-full bg-bg-base border border-bg-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
            placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} />

          {error && <div className="text-loss text-sm">{error}</div>}
          {info && <div className="text-gain text-sm">{info}</div>}

          <button type="submit" disabled={busy}
            className="w-full bg-accent hover:bg-accent/90 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-medium transition-colors">
            {busy ? 'Procesando…' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}
          </button>
        </form>
      </div>
    </div>
  );
}
