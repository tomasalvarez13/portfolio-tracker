import { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import { TrendingUp, Layers, MessageSquare, BarChart2, Shield, Zap } from 'lucide-react';

// ── Animaciones ───────────────────────────────────────────────────────────────
const DEMO_STYLES = `
@keyframes lnd-count  { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
@keyframes lnd-draw   { from { stroke-dashoffset:400; } to { stroke-dashoffset:0; } }
@keyframes lnd-fadein { from { opacity:0; transform:translateY(5px); } to { opacity:1; transform:translateY(0); } }
@keyframes lnd-pulse  { 0%,100% { opacity:1; } 50% { opacity:.35; } }
`;

// ── Demo: slide Resumen ───────────────────────────────────────────────────────
function DemoResumen() {
  const [n, setN] = useState(0);
  const target = 12_450_000;
  useEffect(() => {
    let f = 0; const id = setInterval(() => {
      f++; setN(Math.round(target * Math.min(f / 50, 1)));
      if (f >= 50) clearInterval(id);
    }, 20);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-4 p-4" style={{ animation: 'lnd-count .4s ease both' }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-gray-400">Patrimonio total</div>
          <div className="text-2xl font-bold text-white mt-0.5">
            ${n.toLocaleString('es-CL')}
          </div>
          <div className="text-xs text-emerald-400 mt-0.5">↑ +8.4% este mes</div>
        </div>
        <div className="flex gap-2 text-xs">
          {['CLP','USD'].map(c => (
            <span key={c} className={`px-2 py-1 rounded-md ${c==='CLP' ? 'bg-blue-500/20 text-blue-400' : 'text-gray-500'}`}>{c}</span>
          ))}
        </div>
      </div>

      {/* Chart */}
      <svg viewBox="0 0 300 70" className="w-full" style={{ overflow:'visible' }}>
        <defs>
          <linearGradient id="dg1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity=".25"/>
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0"/>
          </linearGradient>
        </defs>
        <path d="M0,65 C25,65 30,55 55,44 C80,33 90,46 115,33 C140,20 150,30 175,18 C200,7 215,13 240,6 C265,0 280,3 300,2 L300,70 L0,70Z" fill="url(#dg1)"/>
        <path d="M0,65 C25,65 30,55 55,44 C80,33 90,46 115,33 C140,20 150,30 175,18 C200,7 215,13 240,6 C265,0 280,3 300,2"
          fill="none" stroke="#3b82f6" strokeWidth="2"
          strokeDasharray="400" style={{ animation:'lnd-draw 1.6s ease both .3s' }}/>
      </svg>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { l: 'Posiciones',   v: '7'      },
          { l: 'Rent. real',   v: '+6.2%'  },
          { l: 'Neto inv.',    v: '$9.8M'  },
        ].map(({ l, v }, i) => (
          <div key={l} className="bg-white/5 rounded-xl p-2.5 text-center"
            style={{ animation: `lnd-fadein .35s ease both ${i * 80}ms` }}>
            <div className="text-[10px] text-gray-400">{l}</div>
            <div className="font-semibold text-sm mt-0.5 text-white">{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Demo: slide Posiciones ────────────────────────────────────────────────────
const MOCK_POS = [
  { cat: 'Fondos Mutuos', catVal: '$5.28M', items: [
    { name: 'Fintual Risky Norris', val: '$3.12M', pct: '25.1%', ch: '+14.2%', g: true },
    { name: 'Banchile Money Market', val: '$2.16M', pct: '17.4%', ch: '+2.1%', g: true },
  ]},
  { cat: 'Acciones USA', catVal: '$4.13M', items: [
    { name: 'Apple Inc.', val: '$1.89M', pct: '15.2%', ch: '-1.1%', g: false },
    { name: 'Microsoft',  val: '$2.24M', pct: '18.0%', ch: '+4.3%', g: true  },
  ]},
];

function DemoPosiciones() {
  return (
    <div className="p-3 space-y-2">
      {MOCK_POS.map((grp, gi) => (
        <div key={grp.cat} className="rounded-xl border border-white/8 overflow-hidden"
          style={{ animation: `lnd-fadein .35s ease both ${gi * 120}ms` }}>
          <div className="flex items-center justify-between px-3 py-2 bg-white/5">
            <div>
              <div className="text-xs font-medium text-white">▾ {grp.cat}</div>
              <div className="text-[10px] text-gray-400">{grp.items.length} instrumentos</div>
            </div>
            <div className="text-sm font-semibold text-white">{grp.catVal}</div>
          </div>
          {grp.items.map((p, pi) => (
            <div key={p.name} className="flex items-center gap-2 px-3 py-2 border-t border-white/5"
              style={{ animation: `lnd-fadein .3s ease both ${gi * 120 + pi * 80 + 100}ms` }}>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-white truncate">{p.name}</div>
                <div className="text-[10px] text-gray-400">{p.pct} del portafolio</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs font-semibold text-white">{p.val}</div>
                <div className={`text-[10px] font-medium ${p.g ? 'text-emerald-400' : 'text-red-400'}`}>{p.ch}</div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Demo: slide Chat ──────────────────────────────────────────────────────────
const CHAT_MSGS = [
  { role: 'user', text: '¿Cuál es mi posición más rentable?',                        delay: 100  },
  { role: 'ai',   text: 'Tu mejor posición es Fintual Risky Norris con +14.2%. Representa el 25% de tu portafolio y suma +$386.000 este mes.', delay: 700  },
  { role: 'user', text: 'Registra un aporte de $150.000 de hoy',                     delay: 1400 },
  { role: 'ai',   text: '', proposal: true,                                           delay: 2000 },
];

function DemoChat() {
  const [vis, setVis] = useState(0);
  useEffect(() => {
    CHAT_MSGS.forEach((m, i) => setTimeout(() => setVis(v => Math.max(v, i + 1)), m.delay));
  }, []);

  return (
    <div className="p-3 space-y-2 flex flex-col justify-end" style={{ minHeight: 220 }}>
      {CHAT_MSGS.slice(0, vis).map((m, i) => (
        <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          style={{ animation: 'lnd-fadein .25s ease both' }}>
          {m.proposal ? (
            <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-xl px-3 py-2.5 text-xs space-y-2 max-w-[90%]">
              <div className="font-semibold text-emerald-400 text-[10px] uppercase tracking-wide">Propuesta de acción</div>
              <div className="text-white">Aporte de <strong>$150.000 CLP</strong> — hoy</div>
              <div className="flex gap-2">
                <span className="bg-blue-500/20 text-blue-400 px-2.5 py-1 rounded-lg">✓ Confirmar</span>
                <span className="text-gray-500 px-2.5 py-1 rounded-lg">Cancelar</span>
              </div>
            </div>
          ) : m.role === 'user' ? (
            <div className="bg-blue-500/20 text-white text-xs rounded-2xl rounded-tr-sm px-3 py-2 max-w-[85%]">{m.text}</div>
          ) : (
            <div className="bg-white/6 border border-white/10 text-gray-200 text-xs rounded-2xl rounded-tl-sm px-3 py-2 max-w-[90%] leading-relaxed">{m.text}</div>
          )}
        </div>
      ))}
      {vis < CHAT_MSGS.length && (
        <div className="flex justify-start">
          <div className="bg-white/6 border border-white/10 rounded-2xl px-3 py-2.5 flex gap-1.5">
            {[0,1,2].map(d => (
              <span key={d} className="w-1.5 h-1.5 rounded-full bg-gray-400"
                style={{ animation:`lnd-pulse 1s ease infinite ${d*200}ms` }}/>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tabs demo ─────────────────────────────────────────────────────────────────
const TABS = [
  { key: 'resumen',    label: 'Dashboard',  Component: DemoResumen   },
  { key: 'posiciones', label: 'Posiciones', Component: DemoPosiciones },
  { key: 'chat',       label: 'Chat IA',    Component: DemoChat      },
];

function AppDemo() {
  const [tab, setTab]     = useState(0);
  const [manual, setManual] = useState(false);

  const next = useCallback(() => setTab(t => (t + 1) % TABS.length), []);

  useEffect(() => {
    if (manual) return;
    const id = setInterval(next, 4000);
    return () => clearInterval(id);
  }, [manual, next]);

  const { Component } = TABS[tab];

  return (
    <div className="w-full max-w-lg mx-auto">
      {/* Tabs */}
      <div className="flex gap-1 justify-center mb-4">
        {TABS.map((t, i) => (
          <button key={t.key} onClick={() => { setTab(i); setManual(true); }}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
              i === tab
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                : 'text-gray-400 hover:text-white hover:bg-white/8'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Mockup frame */}
      <div className="rounded-2xl border border-white/12 overflow-hidden shadow-2xl"
        style={{ background: 'linear-gradient(145deg, #161b22, #0d1117)' }}>
        {/* Fake browser bar */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/8 bg-white/3">
          <div className="flex gap-1.5">
            {['#ff5f56','#ffbd2e','#27c93f'].map(c => (
              <div key={c} className="w-2.5 h-2.5 rounded-full" style={{ background: c, opacity: .7 }}/>
            ))}
          </div>
          <div className="flex-1 mx-3 bg-white/8 rounded-md px-3 py-0.5 text-[10px] text-gray-400 text-center">
            portfolio-tracker.app
          </div>
        </div>

        {/* Sidebar + content */}
        <div className="flex" style={{ minHeight: 260 }}>
          {/* Mini sidebar */}
          <div className="w-28 border-r border-white/6 py-3 px-2 space-y-0.5 shrink-0 hidden sm:block bg-white/2">
            {TABS.map((t, i) => (
              <div key={t.key} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] transition-colors cursor-default ${
                i === tab ? 'bg-blue-500/15 text-blue-400' : 'text-gray-500'
              }`}>
                <div className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: i === tab ? '#3b82f6' : '#374151' }}/>
                {t.label}
              </div>
            ))}
          </div>
          {/* Content */}
          <div className="flex-1 overflow-hidden" key={tab}>
            <Component />
          </div>
        </div>
      </div>

      {/* Auto-rotate dots */}
      <div className="flex justify-center gap-1.5 mt-4">
        {TABS.map((_, i) => (
          <button key={i} onClick={() => { setTab(i); setManual(true); }}
            className={`rounded-full transition-all ${i === tab ? 'w-5 h-1.5 bg-blue-500' : 'w-1.5 h-1.5 bg-white/20 hover:bg-white/40'}`}/>
        ))}
      </div>
    </div>
  );
}

// ── Features ──────────────────────────────────────────────────────────────────
const FEATURES = [
  { Icon: Layers,      title: 'Todas tus posiciones en un lugar',          desc: 'Acciones, fondos mutuos, ETFs, crypto y más. Precios actualizados automáticamente cada día.' },
  { Icon: BarChart2,   title: 'Rentabilidad con metodología profesional',   desc: 'TWR (Time-Weighted Return), el mismo método que usan los fondos de inversión para medir resultados.' },
  { Icon: MessageSquare, title: 'Chat con inteligencia artificial',         desc: 'Consulta, pide análisis y registra movimientos con lenguaje natural. La IA tiene acceso a tu portafolio en tiempo real.' },
  { Icon: TrendingUp,  title: 'Evolución histórica del patrimonio',         desc: 'Gráficos interactivos con selección de rangos para analizar cualquier período.' },
  { Icon: Zap,         title: 'Carga inteligente de cartolas',              desc: 'Sube un PDF o imagen y la IA extrae todas las posiciones automáticamente.' },
  { Icon: Shield,      title: 'Datos seguros y privados',                   desc: 'Cada usuario solo puede ver su propia información. Autenticación segura y datos cifrados.' },
];

// ── Página principal ──────────────────────────────────────────────────────────
export default function Landing() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && session) navigate('/app/resumen', { replace: true });
  }, [session, loading, navigate]);

  if (loading) return null;

  return (
    <>
      <style>{DEMO_STYLES}</style>
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
        <section className="max-w-6xl mx-auto px-6 pt-20 pb-16 text-center">
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

        {/* Demo */}
        <section className="max-w-6xl mx-auto px-6 pb-24">
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold mb-3">Ve la aplicación en acción</h2>
            <p className="text-gray-400 max-w-lg mx-auto text-sm">Navega entre las diferentes vistas para conocer las funcionalidades principales.</p>
          </div>
          <AppDemo />
        </section>

        {/* Features */}
        <section className="max-w-6xl mx-auto px-6 pb-24">
          <div className="text-center mb-14">
            <h2 className="text-2xl sm:text-3xl font-bold mb-3">Todo lo que necesitas</h2>
            <p className="text-gray-400 max-w-xl mx-auto text-sm">Diseñado para inversores individuales que quieren un control real de su patrimonio.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map(({ Icon, title, desc }, i) => (
              <div key={title} className="rounded-2xl p-6 transition-opacity hover:opacity-90"
                style={{
                  background: [
                    'linear-gradient(135deg, rgba(59,130,246,0.10), rgba(16,185,129,0.05))',
                    'linear-gradient(135deg, rgba(16,185,129,0.09), rgba(59,130,246,0.04))',
                    'linear-gradient(135deg, rgba(139,92,246,0.09), rgba(59,130,246,0.05))',
                    'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(236,72,153,0.04))',
                    'linear-gradient(135deg, rgba(245,158,11,0.08), rgba(59,130,246,0.04))',
                    'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(139,92,246,0.04))',
                  ][i % 6],
                }}>
                <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center mb-4">
                  <Icon size={18} className="text-white/80" />
                </div>
                <h3 className="font-semibold text-sm mb-2">{title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA bottom */}
        <section className="max-w-6xl mx-auto px-6 pb-24">
          <div className="rounded-2xl border border-blue-500/20 p-10 text-center"
            style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(16,185,129,0.05))' }}>
            <h2 className="text-2xl sm:text-3xl font-bold mb-3">Empieza a tomar el control</h2>
            <p className="text-gray-400 mb-8 max-w-md mx-auto text-sm">
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
    </>
  );
}
