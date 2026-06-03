import { useState } from 'react';
import { Navigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import { ArrowLeft } from 'lucide-react';

export default function Login() {
  const { session, signIn, signUp } = useAuth();
  const [searchParams] = useSearchParams();
  const [mode, setMode]       = useState(searchParams.get('signup') === '1' ? 'signup' : 'login');
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [name, setName]       = useState('');
  const [error, setError]     = useState(null);
  const [info, setInfo]       = useState(null);
  const [busy, setBusy]       = useState(false);

  if (session) return <Navigate to="/app/resumen" replace />;

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
        setInfo('Cuenta creada. Revisa tu correo para confirmar y luego inicia sesión.');
        setMode('login');
      }
    } catch (err) {
      setError(err.message || 'Error de autenticación');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 text-white relative overflow-hidden" style={{
      background: `
        radial-gradient(ellipse 70% 60% at 30% -10%, rgba(59,130,246,0.15) 0%, transparent 55%),
        radial-gradient(ellipse 50% 40% at 90% 110%, rgba(16,185,129,0.08) 0%, transparent 50%),
        #0d1117
      `,
    }}>

      {/* Volver al landing */}
      <Link to="/" className="absolute top-6 left-6 flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors">
        <ArrowLeft size={15} /> Volver
      </Link>

      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-3">
            <img src="/favicon.svg" alt="Logo" className="w-10 h-10" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">Portfolio Tracker</h1>
          <p className="text-sm text-gray-400 mt-1">
            {mode === 'login' ? 'Bienvenido de vuelta' : 'Crea tu cuenta gratis'}
          </p>
        </div>

        {/* Toggle */}
        <div className="flex gap-1 p-1 rounded-xl bg-white/5 border border-white/8 mb-5">
          {[
            { key: 'login',  label: 'Iniciar sesión' },
            { key: 'signup', label: 'Crear cuenta'   },
          ].map(({ key, label }) => (
            <button key={key} type="button" onClick={() => { setMode(key); setError(null); setInfo(null); }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                mode === key
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-400 hover:text-white'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === 'signup' && (
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Nombre</label>
              <input
                placeholder="Tu nombre"
                value={name} onChange={e => setName(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-blue-500/60 transition-colors" />
            </div>
          )}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Correo electrónico</label>
            <input
              type="email" required
              placeholder="tu@correo.com"
              value={email} onChange={e => setEmail(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-blue-500/60 transition-colors" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Contraseña</label>
            <input
              type="password" required
              placeholder="••••••••"
              value={password} onChange={e => setPassword(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-blue-500/60 transition-colors" />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5 text-sm text-red-400">
              {error}
            </div>
          )}
          {info && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-2.5 text-sm text-emerald-400">
              {info}
            </div>
          )}

          <button type="submit" disabled={busy}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl py-3 text-sm font-semibold transition-colors mt-1">
            {busy ? 'Procesando…' : mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-500 mt-6">
          Al crear una cuenta aceptas el uso responsable de tus datos financieros.
        </p>
      </div>
    </div>
  );
}
