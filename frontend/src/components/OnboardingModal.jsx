import { useState, useEffect } from 'react';
import { ChevronRight, ChevronLeft, X, TrendingUp, Layers, MessageSquare, Upload, Check } from 'lucide-react';

// ── Animaciones CSS ───────────────────────────────────────────────────────────
const STYLES = `
@keyframes countUp   { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
@keyframes drawLine  { from { stroke-dashoffset:400; } to { stroke-dashoffset:0; } }
@keyframes fadeIn    { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
@keyframes pulse2    { 0%,100% { opacity:1; } 50% { opacity:.4; } }
@keyframes slideR    { from { opacity:0; transform:translateX(-8px); } to { opacity:1; transform:translateX(0); } }
@keyframes slideL    { from { opacity:0; transform:translateX(8px); }  to { opacity:1; transform:translateX(0); } }
@keyframes bounce2   { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-4px); } }
`;

// ── Slide 1: Patrimonio animado ───────────────────────────────────────────────
function Slide1() {
  const [count, setCount] = useState(0);
  const target = 12_450_000;
  useEffect(() => {
    let frame = 0; const total = 60;
    const id = setInterval(() => {
      frame++;
      setCount(Math.round(target * (frame / total)));
      if (frame >= total) clearInterval(id);
    }, 25);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="text-center" style={{ animation: 'countUp .6s ease both' }}>
        <div className="text-xs text-muted mb-1">Valor total del portafolio</div>
        <div className="text-3xl font-bold num text-white">
          ${count.toLocaleString('es-CL')}
        </div>
        <div className="text-sm text-gain mt-1">+8.4% este mes ↑</div>
      </div>

      {/* Mini chart SVG animado */}
      <svg viewBox="0 0 280 70" className="w-full max-w-xs" style={{ overflow: 'visible' }}>
        <defs>
          <linearGradient id="og1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#3b82f6" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0"   />
          </linearGradient>
        </defs>
        <path d="M0,60 L0,60 C30,60 35,50 55,42 C75,34 85,45 105,32 C125,19 135,28 155,18 C175,8 185,14 205,6 C225,0 240,4 280,2 L280,70 L0,70 Z"
          fill="url(#og1)" />
        <path d="M0,60 C30,60 35,50 55,42 C75,34 85,45 105,32 C125,19 135,28 155,18 C175,8 185,14 205,6 C225,0 240,4 280,2"
          fill="none" stroke="#3b82f6" strokeWidth="2.5"
          strokeDasharray="400" style={{ animation: 'drawLine 1.8s ease both .3s' }} />
      </svg>

      {/* Mini stats */}
      <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
        {[
          { label: 'Posiciones',   value: '7', delay: '0s'    },
          { label: 'Rentab. real', value: '+6.2%', delay: '.1s' },
          { label: 'Neto inv.',    value: '$9.8M', delay: '.2s' },
        ].map(({ label, value, delay }) => (
          <div key={label} className="bg-white/5 rounded-xl p-3 text-center"
            style={{ animation: `fadeIn .4s ease both ${delay}` }}>
            <div className="text-xs text-muted">{label}</div>
            <div className="font-semibold text-sm num mt-0.5">{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Slide 2: Posiciones animadas ──────────────────────────────────────────────
const MOCK_POSITIONS = [
  { name: 'Fintual Risky Norris', type: 'Fondo', value: '$4.28M', pct: '34.4%', change: '+12.4%', gain: true },
  { name: 'Bitcoin',              type: 'Crypto', value: '$2.15M', pct: '17.3%', change: '+8.2%',  gain: true },
  { name: 'Apple Inc.',           type: 'Acción', value: '$1.89M', pct: '15.2%', change: '-1.1%',  gain: false },
  { name: 'S&P 500 ETF',          type: 'ETF',    value: '$1.54M', pct: '12.4%', change: '+3.7%',  gain: true },
];

function Slide2() {
  return (
    <div className="space-y-2 w-full max-w-sm mx-auto">
      {MOCK_POSITIONS.map((p, i) => (
        <div key={p.name} className="flex items-center gap-3 bg-white/5 rounded-xl px-3 py-2.5"
          style={{ animation: `fadeIn .35s ease both ${i * 80}ms` }}>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{p.name}</div>
            <div className="text-xs text-muted">{p.type} · {p.pct}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-sm num font-medium">{p.value}</div>
            <div className={`text-xs num ${p.gain ? 'text-gain' : 'text-loss'}`}>{p.change}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Slide 3: Chat IA animado ───────────────────────────────────────────────────
const CHAT_MSGS = [
  { role: 'user', text: '¿Cómo está mi portafolio?',              delay: 100  },
  { role: 'ai',   text: 'Tu portafolio vale $12.4M CLP (+8.4% este mes). Tu mejor posición es Fintual con 34%.', delay: 600  },
  { role: 'user', text: 'Registrá un aporte de $200.000 de hoy', delay: 1200 },
  { role: 'ai',   text: '¿Confirmo aporte de $200.000 para hoy?', delay: 1700, isProposal: true },
];

function Slide3() {
  const [visible, setVisible] = useState(0);
  useEffect(() => {
    CHAT_MSGS.forEach((m, i) => {
      setTimeout(() => setVisible(v => Math.max(v, i + 1)), m.delay);
    });
  }, []);

  return (
    <div className="space-y-2 w-full max-w-sm mx-auto">
      {CHAT_MSGS.slice(0, visible).map((m, i) => (
        <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          style={{ animation: 'slideR .25s ease both' }}>
          {m.isProposal ? (
            <div className="bg-gain/10 border border-gain/30 rounded-xl px-3 py-2.5 text-xs max-w-[85%] space-y-2">
              <div className="font-medium">Propuesta de acción</div>
              <div>{m.text}</div>
              <div className="flex gap-2">
                <span className="bg-accent/20 text-accent px-2 py-1 rounded-lg">✓ Confirmar</span>
                <span className="text-muted px-2 py-1 rounded-lg">Cancelar</span>
              </div>
            </div>
          ) : (
            <div className={`rounded-xl px-3 py-2 text-xs max-w-[85%] leading-relaxed ${
              m.role === 'user'
                ? 'bg-accent/20 text-white'
                : 'bg-white/8 border border-white/10 text-gray-200'
            }`}>
              {m.text}
            </div>
          )}
        </div>
      ))}
      {visible < CHAT_MSGS.length && (
        <div className="flex justify-start">
          <div className="bg-white/8 border border-white/10 rounded-xl px-3 py-2.5 flex gap-1.5">
            {[0,1,2].map(d => (
              <span key={d} className="w-1.5 h-1.5 rounded-full bg-muted"
                style={{ animation: `pulse2 1s ease infinite ${d * 200}ms` }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Slide 4: Cómo empezar ─────────────────────────────────────────────────────
const STEPS = [
  { icon: '📄', title: 'Subí tu cartola',      desc: 'PDF o imagen de tu banco o corretaje'         },
  { icon: '✨', title: 'La IA la procesa',      desc: 'Extrae cada posición automáticamente'          },
  { icon: '✅', title: 'Revisás y confirmás',   desc: 'Editás lo que no cuadre y guardás con un click' },
];

function Slide4({ onStart }) {
  return (
    <div className="space-y-4 w-full max-w-sm mx-auto">
      {STEPS.map((s, i) => (
        <div key={i} className="flex items-center gap-3"
          style={{ animation: `fadeIn .35s ease both ${i * 100}ms` }}>
          <div className="w-10 h-10 rounded-xl bg-accent/15 flex items-center justify-center text-lg shrink-0">
            {s.icon}
          </div>
          <div>
            <div className="text-sm font-medium">{s.title}</div>
            <div className="text-xs text-muted mt-0.5">{s.desc}</div>
          </div>
        </div>
      ))}
      <div className="pt-2 space-y-2" style={{ animation: 'fadeIn .4s ease both .4s' }}>
        <button onClick={() => onStart('cartola')}
          className="w-full py-2.5 rounded-xl bg-accent hover:bg-accent/90 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2">
          <Upload size={15} /> Subir cartola con IA
        </button>
        <button onClick={() => onStart('manual')}
          className="w-full py-2.5 rounded-xl bg-white/8 hover:bg-white/12 text-sm transition-colors">
          Agregar posición manualmente
        </button>
      </div>
    </div>
  );
}

// ── Modal principal ───────────────────────────────────────────────────────────
const SLIDES = [
  {
    icon: TrendingUp,
    title: 'Tu portafolio en tiempo real',
    subtitle: 'Seguí el valor de todas tus inversiones en CLP y USD, con rentabilidad calculada automáticamente.',
    Visual: Slide1,
  },
  {
    icon: Layers,
    title: 'Posiciones siempre actualizadas',
    subtitle: 'Acciones, fondos mutuos, crypto, APV — con precios del mercado actualizados cada día.',
    Visual: Slide2,
  },
  {
    icon: MessageSquare,
    title: 'Chat con IA integrado',
    subtitle: 'Preguntá sobre tu portafolio, pedí análisis, o registrá movimientos con lenguaje natural.',
    Visual: Slide3,
  },
  {
    icon: Upload,
    title: 'Empezá en segundos',
    subtitle: 'Subí tu cartola y la IA extrae todo. O agregá manualmente instrumento por instrumento.',
    Visual: null, // custom
  },
];

export default function OnboardingModal({ onDismiss }) {
  const [idx, setIdx] = useState(0);
  const slide = SLIDES[idx];
  const isLast = idx === SLIDES.length - 1;

  function handleStart(mode) {
    onDismiss(mode); // 'cartola' | 'manual'
  }

  return (
    <>
      <style>{STYLES}</style>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
        <div className="w-full max-w-md bg-bg-card border border-bg-border rounded-2xl shadow-2xl overflow-hidden"
          style={{ animation: 'fadeIn .3s ease both' }}>

          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-0">
            <div className="flex items-center gap-2">
              <slide.icon size={18} className="text-accent" />
              <span className="text-xs text-muted font-medium uppercase tracking-wider">
                {idx + 1} / {SLIDES.length}
              </span>
            </div>
            <button onClick={() => onDismiss('skip')}
              className="p-1.5 rounded-lg text-muted hover:bg-bg-hover hover:text-gray-200 transition-colors">
              <X size={16} />
            </button>
          </div>

          {/* Visual area */}
          <div className="px-5 pt-5 pb-4 min-h-[220px] flex items-center justify-center">
            {isLast
              ? <Slide4 onStart={handleStart} />
              : <slide.Visual key={idx} />
            }
          </div>

          {/* Text */}
          {!isLast && (
            <div className="px-5 pb-4 text-center" key={`text-${idx}`}
              style={{ animation: 'fadeIn .3s ease both' }}>
              <h3 className="font-semibold text-base">{slide.title}</h3>
              <p className="text-sm text-muted mt-1 leading-relaxed">{slide.subtitle}</p>
            </div>
          )}

          {/* Footer nav */}
          {!isLast && (
            <div className="px-5 pb-5 flex items-center justify-between">
              <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}
                className="p-2 rounded-lg text-muted hover:bg-bg-hover disabled:opacity-0 transition-colors">
                <ChevronLeft size={18} />
              </button>

              {/* Dots */}
              <div className="flex gap-1.5">
                {SLIDES.map((_, i) => (
                  <button key={i} onClick={() => setIdx(i)}
                    className={`rounded-full transition-all ${
                      i === idx ? 'w-5 h-2 bg-accent' : 'w-2 h-2 bg-bg-border hover:bg-muted'
                    }`} />
                ))}
              </div>

              <button onClick={() => setIdx(i => i + 1)}
                className="p-2 rounded-lg bg-accent/15 text-accent hover:bg-accent/25 transition-colors">
                <ChevronRight size={18} />
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
