import { useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import { TrendingUp, Layers, MessageSquare, BarChart2, Shield, Zap } from 'lucide-react';

const FEATURES = [
  {
    Icon: Layers,
    title: 'Todas tus posiciones en un lugar',
    desc: 'Acciones, fondos mutuos, ETFs, crypto y más. El sistema calcula el valor actualizado con precios de mercado en tiempo real.',
  },
  {
    Icon: BarChart2,
    title: 'Rentabilidad con metodología profesional',
    desc: 'Calcula tu rentabilidad real con TWR (Time-Weighted Return), el mismo método que usan los fondos de inversión.',
  },
  {
    Icon: MessageSquare,
    title: 'Chat con inteligencia artificial',
    desc: 'Consulta sobre tu portafolio, pide análisis y registra movimientos con lenguaje natural. La IA tiene acceso a tu información en tiempo real.',
  },
  {
    Icon: TrendingUp,
    title: 'Evolución histórica del patrimonio',
    desc: 'Visualiza cómo ha crecido tu portafolio con gráficos interactivos. Selecciona rangos para analizar períodos específicos.',
  },
  {
    Icon: Zap,
    title: 'Carga inteligente de cartolas',
    desc: 'Sube un PDF o imagen de tu estado de cuenta y la IA extrae todas las posiciones automáticamente para que las revises antes de confirmar.',
  },
  {
    Icon: Shield,
    title: 'Tus datos, seguros y privados',
    desc: 'Cada usuario solo puede ver su propia información. Autenticación segura y datos cifrados en la nube.',
  },
];

export default function Landing() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && session) navigate('/resumen', { replace: true });
  }, [session, loading, navigate]);

  if (loading) return null;

  return (
    <div className="min-h-screen text-white" style={{
      background: `
        radial-gradient(ellipse 80% 50% at 80% -10%, rgba(59,130,246,0.18) 0%, transparent 60%),
        radial-gradient(ellipse 60% 40% at 10% 100%, rgba(16,185,129,0.10) 0%, transparent 55%),
        #0d1117
      `,
    }}>

      {/* Nav */}
      <header className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="Logo" className="w-8 h-8" />
          <span className="font-semibold text-base tracking-tight">Portfolio Tracker</span>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/login"
            className="text-sm text-gray-400 hover:text-white transition-colors px-4 py-2 rounded-lg hover:bg-white/5">
            Iniciar sesión
          </Link>
          <Link to="/login?signup=1"
            className="text-sm bg-blue-600 hover:bg-blue-500 transition-colors px-4 py-2 rounded-lg font-medium">
            Crear cuenta
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-24 text-center">
        <div className="inline-flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 rounded-full px-4 py-1.5 text-xs text-blue-400 mb-8 font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          Gestión de inversiones personales
        </div>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight tracking-tight mb-6">
          Tu portafolio de inversiones
          <br />
          <span className="text-transparent bg-clip-text"
            style={{ backgroundImage: 'linear-gradient(135deg, #3b82f6, #10b981)' }}>
            en un solo lugar
          </span>
        </h1>
        <p className="text-lg text-gray-400 max-w-2xl mx-auto leading-relaxed mb-10">
          Registra tus posiciones, analiza tu rentabilidad real y conversa con inteligencia artificial
          para tomar mejores decisiones financieras.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link to="/login?signup=1"
            className="inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 transition-colors px-7 py-3.5 rounded-xl font-semibold text-sm">
            Comenzar gratis
          </Link>
          <Link to="/login"
            className="inline-flex items-center justify-center gap-2 bg-white/6 hover:bg-white/10 border border-white/10 transition-colors px-7 py-3.5 rounded-xl font-semibold text-sm text-gray-300">
            Ya tengo cuenta →
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 pb-24">
        <div className="text-center mb-14">
          <h2 className="text-2xl sm:text-3xl font-bold mb-3">Todo lo que necesitas</h2>
          <p className="text-gray-400 max-w-xl mx-auto">Diseñado para inversores individuales que quieren un control real de su patrimonio.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map(({ Icon, title, desc }) => (
            <div key={title}
              className="rounded-2xl border border-white/8 bg-white/3 p-6 hover:bg-white/5 hover:border-white/12 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-blue-500/15 flex items-center justify-center mb-4">
                <Icon size={18} className="text-blue-400" />
              </div>
              <h3 className="font-semibold text-sm mb-2">{title}</h3>
              <p className="text-sm text-gray-400 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA bottom */}
      <section className="max-w-6xl mx-auto px-6 pb-24">
        <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-10 text-center"
          style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(16,185,129,0.05))' }}>
          <h2 className="text-2xl sm:text-3xl font-bold mb-3">Empieza a tomar el control</h2>
          <p className="text-gray-400 mb-8 max-w-md mx-auto">
            Crea tu cuenta en segundos y agrega tus posiciones subiendo una cartola o de forma manual.
          </p>
          <Link to="/login?signup=1"
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 transition-colors px-8 py-3.5 rounded-xl font-semibold text-sm">
            Crear cuenta gratis
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/6 py-8">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" alt="Logo" className="w-5 h-5 opacity-60" />
            <span className="text-xs text-gray-500">Portfolio Tracker</span>
          </div>
          <p className="text-xs text-gray-600">Tus datos financieros, privados y seguros.</p>
        </div>
      </footer>
    </div>
  );
}
