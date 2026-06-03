import { useEffect, useState, useCallback } from 'react';
import { getMovements, createMovement, updateMovement, deleteMovement } from '../services/api';
import { formatCLP, formatDate, colorForValue } from '../utils/formatters';
import { StatCard } from '../components/ui/Card.jsx';
import { Spinner, ErrorBox } from '../components/ui/Spinner.jsx';
import { ArrowUpCircle, ArrowDownCircle } from 'lucide-react';

const todayISO = () => new Date().toISOString().slice(0, 10);

function MovementForm({ initial, onSubmit, onCancel }) {
  const [date, setDate]      = useState(initial?.date?.slice(0, 10) || todayISO());
  const [type, setType]      = useState(initial?.type || 'aporte');
  const [amount, setAmount]  = useState(initial?.amount_clp || '');
  const [notes, setNotes]    = useState(initial?.notes || '');

  function submit(e) {
    e.preventDefault();
    onSubmit({
      instrument_id: null,
      date,
      type,
      amount_clp: Number(amount),
      notes: notes || null,
    });
  }

  return (
    <form onSubmit={submit} className="card p-5 space-y-4">
      <h3 className="font-medium">{initial ? 'Editar movimiento' : 'Nuevo movimiento'}</h3>

      <div className="flex gap-2">
        {['aporte', 'retiro'].map(t => (
          <button key={t} type="button" onClick={() => setType(t)}
            className={`flex-1 py-2 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 ${
              type === t
                ? t === 'aporte' ? 'bg-gain/15 text-gain font-medium' : 'bg-loss/15 text-loss font-medium'
                : 'text-muted hover:bg-bg-hover'
            }`}>
            {t === 'aporte' ? <ArrowUpCircle size={16}/> : <ArrowDownCircle size={16}/>}
            {t === 'aporte' ? 'Aporte' : 'Retiro'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted">Fecha</label>
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full bg-bg-base border border-bg-border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-xs text-muted">Monto CLP</label>
          <input type="number" step="any" required value={amount} onChange={(e) => setAmount(e.target.value)}
            className="mt-1 w-full bg-bg-base border border-bg-border rounded-lg px-3 py-2 text-sm num" />
        </div>
      </div>

      <div>
        <label className="text-xs text-muted">Notas (opcional)</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)}
          className="mt-1 w-full bg-bg-base border border-bg-border rounded-lg px-3 py-2 text-sm" />
      </div>

      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-sm text-muted hover:bg-bg-hover">Cancelar</button>
        <button type="submit" className="px-4 py-2 rounded-lg text-sm bg-accent hover:bg-accent/90 text-white">Guardar</button>
      </div>
    </form>
  );
}

export default function Movimientos() {
  const [movs, setMovs]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [editing, setEditing]     = useState(null);
  const [filterType, setFilterType] = useState('all');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await getMovements();
      // Solo nivel portafolio (sin instrument_id)
      setMovs(data.filter(m => !m.instrument_id));
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSave(body) {
    try {
      if (editing?.id) await updateMovement(editing.id, body);
      else await createMovement(body);
      setEditing(null);
      await load();
    } catch (e) { setError(e.response?.data?.error || e.message); }
  }
  async function handleDelete(id) {
    if (!confirm('¿Eliminar este movimiento?')) return;
    try { await deleteMovement(id); await load(); }
    catch (e) { setError(e.response?.data?.error || e.message); }
  }

  if (loading) return <Spinner />;

  const filtered = filterType === 'all' ? movs : movs.filter(m => m.type === filterType);
  const totalAportes = movs.filter(m => m.type === 'aporte').reduce((s, m) => s + Number(m.amount_clp || 0), 0);
  const totalRetiros = movs.filter(m => m.type === 'retiro').reduce((s, m) => s + Number(m.amount_clp || 0), 0);
  const neto = totalAportes - totalRetiros;

  // Agrupar por año-mes para tabla resumida
  const byMonth = new Map();
  for (const m of movs) {
    const ym = m.date.slice(0, 7);
    const cur = byMonth.get(ym) || { aportes: 0, retiros: 0, items: [] };
    if (m.type === 'aporte') cur.aportes += Number(m.amount_clp || 0);
    else cur.retiros += Number(m.amount_clp || 0);
    cur.items.push(m);
    byMonth.set(ym, cur);
  }

  const MES_LABELS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const fmtMes = (ym) => {
    const [y, m] = ym.split('-');
    return `${MES_LABELS[Number(m) - 1]} ${y}`;
  };

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg lg:text-xl font-semibold">Movimientos</h2>
        <button onClick={() => setEditing({})}
          className="px-3 py-2 rounded-lg text-xs lg:text-sm bg-accent hover:bg-accent/90 text-white">
          + Nuevo
        </button>
      </div>

      {error && <ErrorBox message={error} />}
      {editing && (
        <MovementForm initial={editing.id ? editing : null} onSubmit={handleSave} onCancel={() => setEditing(null)} />
      )}

      {/* Totales */}
      <div className="grid grid-cols-3 gap-3 lg:gap-4">
        <StatCard label="Aportes totales" value={formatCLP(totalAportes)} valueClass="text-gain" />
        <StatCard label="Retiros totales" value={formatCLP(totalRetiros)} valueClass="text-loss" />
        <StatCard label="Neto invertido"   value={formatCLP(neto)} />
      </div>

      {/* Filtro */}
      <div className="flex gap-1 text-xs bg-bg-card border border-bg-border rounded-lg p-1 w-fit">
        {[
          { k: 'all', label: 'Todos' },
          { k: 'aporte', label: 'Aportes' },
          { k: 'retiro', label: 'Retiros' },
        ].map(f => (
          <button key={f.k} onClick={() => setFilterType(f.k)}
            className={`px-3 py-1.5 rounded-md transition-colors ${
              filterType === f.k ? 'bg-accent/20 text-accent font-medium' : 'text-muted hover:text-gray-200'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Resumen mensual */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-bg-border font-medium text-sm">Resumen por mes</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[400px]">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-bg-border">
                <th className="px-4 py-3 font-medium">Mes</th>
                <th className="px-4 py-3 font-medium text-right">Aportes</th>
                <th className="px-4 py-3 font-medium text-right">Retiros</th>
                <th className="px-4 py-3 font-medium text-right">Neto</th>
              </tr>
            </thead>
            <tbody>
              {[...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([ym, g]) => (
                <tr key={ym} className="border-b border-bg-border/50 hover:bg-bg-hover/40">
                  <td className="px-4 py-3">{fmtMes(ym)}</td>
                  <td className="px-4 py-3 text-right num text-gain">{g.aportes > 0 ? formatCLP(g.aportes) : '—'}</td>
                  <td className="px-4 py-3 text-right num text-loss">{g.retiros > 0 ? formatCLP(g.retiros) : '—'}</td>
                  <td className={`px-4 py-3 text-right num ${colorForValue(g.aportes - g.retiros)}`}>
                    {formatCLP(g.aportes - g.retiros, { sign: true })}
                  </td>
                </tr>
              ))}
              {byMonth.size === 0 && (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-muted">Aún no hay movimientos.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Listado detalle */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-bg-border font-medium text-sm">
          Detalle ({filtered.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-bg-border">
                <th className="px-4 py-3 font-medium">Fecha</th>
                <th className="px-4 py-3 font-medium">Tipo</th>
                <th className="px-4 py-3 font-medium text-right">Monto CLP</th>
                <th className="px-4 py-3 font-medium">Notas</th>
                <th className="px-4 py-3 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(m => (
                <tr key={m.id} className="border-b border-bg-border/50 hover:bg-bg-hover/40">
                  <td className="px-4 py-3 num">{formatDate(m.date)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-xs ${m.type === 'aporte' ? 'text-gain' : 'text-loss'}`}>
                      {m.type === 'aporte' ? <ArrowUpCircle size={14}/> : <ArrowDownCircle size={14}/>}
                      {m.type === 'aporte' ? 'Aporte' : 'Retiro'}
                    </span>
                  </td>
                  <td className={`px-4 py-3 text-right num ${m.type === 'aporte' ? 'text-gain' : 'text-loss'}`}>
                    {formatCLP(m.amount_clp)}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted truncate max-w-[260px]" title={m.notes}>{m.notes || '—'}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setEditing(m)} className="text-xs text-muted hover:text-gray-200 mr-2">editar</button>
                    <button onClick={() => handleDelete(m.id)} className="text-xs text-muted hover:text-loss">eliminar</button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">Sin movimientos para mostrar.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
