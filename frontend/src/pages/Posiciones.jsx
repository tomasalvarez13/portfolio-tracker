import { useEffect, useState, useCallback } from 'react';
import {
  getPositions, getInstruments, createPosition, updatePosition,
  deletePosition, setManualPrice, refreshPrices,
} from '../services/api';
import {
  formatCLP, formatUSD, formatPct, formatUnits, formatDate,
  categoryOf, CATEGORY_LABELS, CATEGORY_ORDER,
} from '../utils/formatters';
import { StaleBadge } from '../components/ui/Badge.jsx';
import { Spinner, ErrorBox } from '../components/ui/Spinner.jsx';
import PositionForm from '../components/positions/PositionForm.jsx';
import ManualPriceForm from '../components/positions/ManualPriceForm.jsx';

export default function Posiciones() {
  const [data, setData] = useState(null);
  const [instruments, setInstruments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [pricing, setPricing] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState({}); // categorías expandidas

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [pos, inst] = await Promise.all([getPositions(), getInstruments()]);
      setData(pos);
      setInstruments(inst);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSave(body) {
    try {
      if (editing?.id) await updatePosition(editing.id, body);
      else await createPosition(body);
      setEditing(null);
      await load();
    } catch (e) { setError(e.response?.data?.error || e.message); }
  }
  async function handleDelete(id) {
    if (!confirm('¿Eliminar esta posición?')) return;
    try { await deletePosition(id); await load(); }
    catch (e) { setError(e.response?.data?.error || e.message); }
  }
  async function handleManualPrice(body) {
    try { await setManualPrice(body); setPricing(null); await load(); }
    catch (e) { setError(e.response?.data?.error || e.message); }
  }
  async function handleRefresh() {
    setRefreshing(true);
    try { await refreshPrices(); await load(); }
    catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setRefreshing(false); }
  }

  if (loading) return <Spinner />;

  const positions = data?.positions || [];
  const totalClp = data?.totalClp || 0;

  // Agrupar por categoría de alto nivel
  const groups = {};
  for (const p of positions) {
    const cat = categoryOf(p.type);
    if (!groups[cat]) groups[cat] = { items: [], value_clp: 0, value_usd: 0 };
    groups[cat].items.push(p);
    groups[cat].value_clp += p.value_clp || 0;
    groups[cat].value_usd += p.value_usd || 0;
  }
  const visibleCats = CATEGORY_ORDER.filter((c) => groups[c]?.items.length);

  const toggle = (cat) => setOpen((o) => ({ ...o, [cat]: !o[cat] }));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg lg:text-xl font-semibold">Posiciones</h2>
          {data?.priceDate && (
            <p className="text-xs text-muted mt-0.5">Último precio: {formatDate(data.priceDate)}</p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={handleRefresh} disabled={refreshing}
            className="px-3 py-2 rounded-lg text-xs lg:text-sm border border-bg-border text-muted hover:bg-bg-hover disabled:opacity-50">
            {refreshing ? 'Actualizando…' : '↻ Actualizar'}
          </button>
          <button onClick={() => setEditing({})}
            className="px-3 py-2 rounded-lg text-xs lg:text-sm bg-accent hover:bg-accent/90 text-white">+ Nueva</button>
        </div>
      </div>

      {error && <ErrorBox message={error} />}
      {editing && (
        <PositionForm instruments={instruments} initial={editing.id ? editing : null}
          onSubmit={handleSave} onCancel={() => setEditing(null)} />
      )}
      {pricing && (
        <ManualPriceForm position={pricing} onSubmit={handleManualPrice} onCancel={() => setPricing(null)} />
      )}

      {positions.length === 0 ? (
        <div className="card p-10 text-center text-muted">
          No tienes posiciones. Crea la primera con “+ Nueva posición”.
        </div>
      ) : (
        <div className="space-y-3">
          {visibleCats.map((cat) => {
            const g = groups[cat];
            const pct = totalClp > 0 ? (g.value_clp / totalClp) * 100 : 0;
            const isOpen = !!open[cat];
            return (
              <div key={cat} className="card overflow-hidden">
                {/* Fila resumen de la categoría */}
                <button onClick={() => toggle(cat)}
                  className="w-full flex items-center gap-4 px-5 py-4 hover:bg-bg-hover/40 transition-colors text-left">
                  <span className={`text-muted transition-transform ${isOpen ? 'rotate-90' : ''}`}>▸</span>
                  <div className="flex-1">
                    <div className="font-medium">{CATEGORY_LABELS[cat]}</div>
                    <div className="text-xs text-muted">{g.items.length} {g.items.length === 1 ? 'instrumento' : 'instrumentos'}</div>
                  </div>
                  <div className="text-right">
                    <div className="num font-medium">{formatCLP(g.value_clp)}</div>
                    <div className="num text-xs text-muted">{formatUSD(g.value_usd)}</div>
                  </div>
                  <div className="w-20 text-right num text-sm text-muted">{formatPct(pct, { sign: false })}</div>
                </button>

                {/* Detalle desplegable */}
                {isOpen && (
                  <div className="overflow-x-auto">
                  <table className="w-full text-sm border-t border-bg-border min-w-[640px]">
                    <thead>
                      <tr className="text-left text-xs text-muted border-b border-bg-border/60">
                        <th className="px-5 py-2 font-medium">Instrumento</th>
                        <th className="px-4 py-2 font-medium text-right">Unidades/Monto</th>
                        <th className="px-4 py-2 font-medium text-right">Precio</th>
                        <th className="px-4 py-2 font-medium text-right">Valor CLP</th>
                        <th className="px-4 py-2 font-medium text-right">Valor USD</th>
                        <th className="px-4 py-2 font-medium text-right">% Port.</th>
                        <th className="px-4 py-2 font-medium text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.items.map((p) => (
                        <tr key={p.id} className="border-b border-bg-border/40 last:border-0 hover:bg-bg-hover/30">
                          <td className="px-5 py-2.5">
                            <div className="font-medium">{p.alias || p.name}</div>
                            {p.ticker && <div className="text-xs text-muted">{p.ticker}</div>}
                          </td>
                          <td className="px-4 py-2.5 text-right num">
                            {p.units != null ? formatUnits(p.units)
                              : p.amount_clp != null ? formatCLP(p.amount_clp) : formatUSD(p.amount_usd)}
                          </td>
                          <td className="px-4 py-2.5 text-right num">
                            <div className="flex items-center justify-end gap-1.5">
                              {p.is_stale && <StaleBadge />}
                              {p.currency === 'USD' && p.price_usd != null ? formatUSD(p.price_usd)
                                : p.price_clp != null ? formatCLP(p.price_clp) : '—'}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right num">{formatCLP(p.value_clp)}</td>
                          <td className="px-4 py-2.5 text-right num text-muted">{formatUSD(p.value_usd)}</td>
                          <td className="px-4 py-2.5 text-right num text-muted">{formatPct(p.pct_portfolio, { sign: false })}</td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
                            {p.api_source === 'manual' && (
                              <button onClick={() => setPricing(p)} className="text-xs text-accent hover:underline mr-2">precio</button>
                            )}
                            <button onClick={() => setEditing(p)} className="text-xs text-muted hover:text-gray-200 mr-2">editar</button>
                            <button onClick={() => handleDelete(p.id)} className="text-xs text-muted hover:text-loss">eliminar</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                )}
              </div>
            );
          })}

          {/* Total general */}
          <div className="card px-5 py-4 flex items-center gap-4 font-medium">
            <span className="w-4" />
            <div className="flex-1">Total portafolio</div>
            <div className="text-right">
              <div className="num">{formatCLP(totalClp)}</div>
              <div className="num text-xs text-muted">{formatUSD(data.totalUsd)}</div>
            </div>
            <div className="w-20 text-right num text-sm text-muted">100,00%</div>
          </div>
        </div>
      )}
    </div>
  );
}
