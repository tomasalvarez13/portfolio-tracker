import { useState, useRef, useEffect } from 'react';
import { sendChatMessage, createMovement, addAporte } from '../services/api';
import { formatCLP, formatUSD, formatDate } from '../utils/formatters';
import { Send, Bot, User, CheckCircle, XCircle, Sparkles } from 'lucide-react';

// ── Tarjeta de propuesta de acción ───────────────────────────────────────────
function ProposalCard({ action, onConfirm, onCancel }) {
  const isRetiro = action.params?.type === 'retiro';

  if (action.endpoint === 'create_movement') {
    const { date, type, amount_clp, notes } = action.params;
    return (
      <div className={`rounded-xl border p-4 space-y-3 ${
        isRetiro ? 'border-loss/40 bg-loss/5' : 'border-gain/40 bg-gain/5'
      }`}>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Propuesta de acción</p>
        <div className="space-y-1">
          <p className="text-sm font-medium capitalize">{type} · {formatCLP(amount_clp)}</p>
          <p className="text-xs text-muted">Fecha: {formatDate(date)}</p>
          {notes && <p className="text-xs text-muted">{notes}</p>}
        </div>
        <div className="flex gap-2">
          <button onClick={onConfirm}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-accent text-white hover:bg-accent/90">
            <CheckCircle size={12} /> Confirmar
          </button>
          <button onClick={onCancel}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted hover:bg-bg-hover">
            <XCircle size={12} /> Cancelar
          </button>
        </div>
      </div>
    );
  }

  if (action.endpoint === 'add_to_position') {
    const { instrument_name, type, delta, mode, date, notes } = action.params;
    const deltaFmt = mode === 'amount_clp' ? formatCLP(delta)
      : mode === 'amount_usd' ? formatUSD(delta)
      : `${delta} unidades`;
    return (
      <div className={`rounded-xl border p-4 space-y-3 ${
        isRetiro ? 'border-loss/40 bg-loss/5' : 'border-gain/40 bg-gain/5'
      }`}>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Propuesta de acción</p>
        <div className="space-y-1">
          <p className="text-sm font-medium">{isRetiro ? '−' : '+'} {deltaFmt} en <span className="text-accent">{instrument_name}</span></p>
          {action.position
            ? <p className="text-xs text-muted">Posición: {action.position.alias || action.position.name}</p>
            : <p className="text-xs text-loss">⚠ Instrumento no encontrado exactamente — confirmá solo si es correcto</p>}
          <p className="text-xs text-muted">Fecha: {formatDate(date)}</p>
          {notes && <p className="text-xs text-muted">{notes}</p>}
        </div>
        <div className="flex gap-2">
          <button onClick={onConfirm} disabled={!action.position}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-accent text-white hover:bg-accent/90 disabled:opacity-40">
            <CheckCircle size={12} /> Confirmar
          </button>
          <button onClick={onCancel}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted hover:bg-bg-hover">
            <XCircle size={12} /> Cancelar
          </button>
        </div>
      </div>
    );
  }

  return null;
}

// ── Sugerencias iniciales ────────────────────────────────────────────────────
const SUGGESTIONS = [
  '¿Cómo está distribuido mi portafolio?',
  '¿Cuánto gané o perdí este mes?',
  'Registrá un aporte de $200.000 de hoy',
  '¿Cuál es mi posición más grande?',
];

export default function Chat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState('');
  const [thinking, setThinking] = useState(false);
  const bottomRef               = useRef(null);
  const textareaRef             = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  // Auto-resize textarea
  function handleInput(e) {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  async function send(text = input.trim()) {
    if (!text || thinking) return;

    const userMsg   = { role: 'user', content: text };
    const nextMsgs  = [...messages, userMsg];
    setMessages(nextMsgs);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setThinking(true);

    try {
      // Solo enviar mensajes de texto reales (filtrar metadatos UI)
      const apiMsgs = nextMsgs
        .filter(m => m.content && !m._proposal)
        .map(m => ({ role: m.role, content: m.content }));

      const result = await sendChatMessage(apiMsgs);

      if (result.type === 'message') {
        setMessages(ms => [...ms, { role: 'assistant', content: result.content }]);
      } else if (result.type === 'proposal') {
        setMessages(ms => [
          ...ms,
          ...(result.message ? [{ role: 'assistant', content: result.message }] : []),
          { role: 'assistant', content: '', _proposal: result.action },
        ]);
      }
    } catch (e) {
      setMessages(ms => [...ms, {
        role: 'assistant',
        content: `Ocurrió un error: ${e.response?.data?.error || e.message}`,
      }]);
    } finally {
      setThinking(false);
    }
  }

  async function handleConfirm(msg) {
    const { action } = { action: msg._proposal };
    try {
      if (action.endpoint === 'create_movement') {
        await createMovement(action.params);
      } else if (action.endpoint === 'add_to_position' && action.position) {
        const { type, delta, mode, movement_clp, date, notes } = action.params;
        await addAporte(action.position.id, {
          type, date, notes,
          [`delta_${mode}`]: delta,
          movement_clp: movement_clp ?? (mode === 'amount_clp' ? delta : null),
        });
      }
      setMessages(ms => ms.map(m =>
        m._proposal === msg._proposal
          ? { role: 'assistant', content: '✓ Movimiento registrado correctamente.' }
          : m
      ));
    } catch (e) {
      setMessages(ms => ms.map(m =>
        m._proposal === msg._proposal
          ? { ...m, _error: e.response?.data?.error || e.message }
          : m
      ));
    }
  }

  function handleCancel(msg) {
    setMessages(ms => ms.map(m =>
      m._proposal === msg._proposal
        ? { role: 'assistant', content: 'Entendido, cancelé la acción.' }
        : m
    ));
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100dvh - 7rem)' }}>

      {/* Header */}
      <div className="mb-4 shrink-0">
        <h2 className="text-lg lg:text-xl font-semibold flex items-center gap-2">
          <Sparkles size={18} className="text-accent" /> Chat
        </h2>
        <p className="text-xs text-muted mt-0.5">Preguntá sobre tu portafolio o pedí que registre movimientos</p>
      </div>

      {/* Mensajes */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-2 min-h-0">

        {/* Estado vacío con sugerencias */}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center py-8">
            <div>
              <Bot size={36} className="mx-auto text-accent/50 mb-3" />
              <p className="text-sm text-muted">Hola, soy tu asistente de portafolio.</p>
              <p className="text-xs text-muted mt-1">Tengo acceso a tus posiciones y movimientos.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 w-full max-w-sm">
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => send(s)}
                  className="text-left text-xs text-muted border border-bg-border rounded-xl px-3 py-2.5 hover:bg-bg-hover hover:text-gray-200 transition-colors leading-snug">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Lista de mensajes */}
        {messages.map((msg, i) => {
          // Propuesta de acción
          if (msg._proposal) {
            return (
              <div key={i} className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-accent/15 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot size={14} className="text-accent" />
                </div>
                <div className="flex-1 space-y-1.5">
                  <ProposalCard action={msg._proposal} onConfirm={() => handleConfirm(msg)} onCancel={() => handleCancel(msg)} />
                  {msg._error && <p className="text-xs text-loss">{msg._error}</p>}
                </div>
              </div>
            );
          }

          if (!msg.content) return null;

          // Mensaje del usuario
          if (msg.role === 'user') {
            return (
              <div key={i} className="flex gap-2.5 justify-end">
                <div className="max-w-[78%] bg-accent/15 text-sm rounded-2xl rounded-tr-sm px-4 py-2.5 leading-relaxed">
                  {msg.content}
                </div>
                <div className="w-7 h-7 rounded-full bg-bg-hover flex items-center justify-center shrink-0 mt-0.5">
                  <User size={14} className="text-muted" />
                </div>
              </div>
            );
          }

          // Mensaje del asistente
          return (
            <div key={i} className="flex gap-2.5">
              <div className="w-7 h-7 rounded-full bg-accent/15 flex items-center justify-center shrink-0 mt-0.5">
                <Bot size={14} className="text-accent" />
              </div>
              <div className="flex-1 bg-bg-card border border-bg-border text-sm rounded-2xl rounded-tl-sm px-4 py-2.5 leading-relaxed whitespace-pre-wrap max-w-[85%]">
                {msg.content}
              </div>
            </div>
          );
        })}

        {/* Indicador de escritura */}
        {thinking && (
          <div className="flex gap-2.5">
            <div className="w-7 h-7 rounded-full bg-accent/15 flex items-center justify-center shrink-0">
              <Bot size={14} className="text-accent" />
            </div>
            <div className="bg-bg-card border border-bg-border rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex gap-1.5 items-center">
                {[0, 150, 300].map(d => (
                  <span key={d} className="w-1.5 h-1.5 rounded-full bg-muted/60 animate-bounce"
                    style={{ animationDelay: `${d}ms` }} />
                ))}
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-bg-border pt-3 mt-2">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKey}
            placeholder="Escribí tu mensaje… (Enter para enviar, Shift+Enter para nueva línea)"
            rows={1}
            className="flex-1 bg-bg-card border border-bg-border rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:border-accent/50 placeholder:text-muted"
            style={{ minHeight: '44px', maxHeight: '120px' }}
          />
          <button onClick={() => send()} disabled={!input.trim() || thinking}
            className="p-2.5 rounded-xl bg-accent hover:bg-accent/90 text-white disabled:opacity-40 shrink-0 transition-opacity">
            <Send size={16} />
          </button>
        </div>
        <p className="text-[10px] text-muted/60 mt-1.5 text-center">
          La IA puede cometer errores — verificá los movimientos antes de confirmar.
        </p>
      </div>
    </div>
  );
}
