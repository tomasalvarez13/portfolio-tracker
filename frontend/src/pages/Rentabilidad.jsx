import { useState, useCallback, useEffect } from 'react';
import {
  getRentabilidad, getMonthlyRentabilidad, getTWR,
  getSnapshots, getMovements,
} from '../services/api';
import { formatCLP, formatPct, formatDate, colorForValue } from '../utils/formatters';
import { StatCard } from '../components/ui/Card.jsx';
import { Spinner, ErrorBox } from '../components/ui/Spinner.jsx';
import EvolutionChart from '../components/summary/EvolutionChart.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { usePersistedFetch } from '../hooks/usePersistedFetch.js';

const fetchInit = async () => {
  const [snap, mov] = await Promise.all([getSnapshots(), getMovements({ type: 'aporte' })]);
  return {
    snapshots: snap,
    aportes:   mov.filter(m => !m.instrument_id)
                  .map(m => ({ date: m.date?.slice(0, 10), amount: Number(m.amount_clp) })),
  };
};

export default function Rentabilidad() {
  const { user }  = useAuth();
  const { data: initData, loading, syncing } =
    usePersistedFetch(user?.id ? `rentabilidad_init_${user.id}` : null, fetchInit);

  const snapshots = initData?.snapshots ?? [];
  const aportes   = initData?.aportes   ?? [];

  const [range,    setRange]    = useState(null);
  const [rent,     setRent]     = useState(null);
  const [twr,      setTwr]      = useState(null);
  const [monthly,  setMonthly]  = useState([]);
  const [currency, setCurrency] = useState('CLP');

  // Cuando cambia el rango (selector o drag), refresca métricas.
  // Cada endpoint se llama por separado para que si TWR falla (ej: backend viejo
  // sin ese endpoint), las otras métricas igual se muestren.
  const refreshMetrics = useCallback(async (from, to) => {
    if (!from || !to) return;
    setError(null);
    const safe = (p) => p.catch(() => null);
    const [r, t, m] = await Promise.all([
      safe(getRentabilidad({ from, to })),
      safe(getTWR({ from, to })),
      safe(getMonthlyRentabilidad({ from, to })),
    ]);
    setRent(r); setTwr(t); setMonthly(m || []);
  }, []);

  useEffect(() => {
    if (range?.from && range?.to) refreshMetrics(range.from, range.to);
  }, [range, refreshMetrics]);

  if (loading) return <Spinner />;

  const MES_LABELS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const fmtMonth = (ym) => {
    const [y, m] = ym.split('-');
    return `${MES_LABELS[Number(m) - 1]} ${y}`;
  };

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg lg:text-xl font-semibold">Rentabilidad</h2>
        {syncing && (
          <div className="flex items-center gap-2 text-xs text-muted px-3 py-2 bg-bg-card border border-bg-border rounded-lg">
            <span className="inline-block w-3 h-3 rounded-full border-2 border-muted border-t-transparent animate-spin" />
            Actualizando…
          </div>
        )}
        <div className="flex gap-1 text-xs bg-bg-card border border-bg-border rounded-lg p-1">
          {['CLP', 'USD'].map(c => (
            <button key={c} onClick={() => setCurrency(c)}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                currency === c ? 'bg-accent/20 text-accent font-medium' : 'text-muted hover:text-gray-200'
              }`}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Gráfico con selector + click-and-drag */}
      <EvolutionChart
        snapshots={snapshots}
        aportes={aportes}
        currency={currency}
        defaultRange="ytd"
        onRangeChange={setRange}
      />

      {/* Banner del rango activo */}
      {range && (
        <div className="text-xs text-muted">
          Métricas calculadas para: <span className="text-gray-200 num">{formatDate(range.from)} → {formatDate(range.to)}</span>
          {range.source === 'drag' && <span className="ml-2 text-accent">(rango seleccionado en el gráfico)</span>}
        </div>
      )}

      {/* Tarjetas */}
      {rent?.error ? (
        <div className="card p-5 text-muted text-sm">{rent.error}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">
            <StatCard label="Rentabilidad total"
              value={formatPct(rent?.rentabilidad_total_pct)}
              sub={formatCLP(rent?.rentabilidad_total_clp, { sign: true })}
              valueClass={colorForValue(rent?.rentabilidad_total_pct)} />
            <StatCard label="Rentabilidad real (TWR)"
              value={formatPct(twr?.twr_pct)}
              sub={twr?.twr_clp_aprox != null ? `≈ ${formatCLP(twr.twr_clp_aprox, { sign: true })}` : '—'}
              valueClass={colorForValue(twr?.twr_pct)} />
            <StatCard label="Aportes netos del período"
              value={formatCLP(rent?.aportes_netos_clp)}
              sub={`Aportes ${formatCLP(rent?.aportes_periodo_clp)} · Retiros ${formatCLP(rent?.retiros_periodo_clp)}`} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:gap-4">
            <StatCard label="Valor inicial" value={formatCLP(rent?.valor_inicial_clp)} />
            <StatCard label="Valor final"   value={formatCLP(rent?.valor_final_clp)} />
          </div>

          {/* Resumen mensual */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-bg-border font-medium text-sm">Resumen mensual</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[480px]">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-bg-border">
                    <th className="px-4 py-3 font-medium">Mes</th>
                    <th className="px-4 py-3 font-medium text-right">% Rentabilidad</th>
                    <th className="px-4 py-3 font-medium text-right">Rentabilidad real CLP</th>
                    <th className="px-4 py-3 font-medium text-right">Aportes netos</th>
                  </tr>
                </thead>
                <tbody>
                  {monthly.map(m => (
                    <tr key={m.mes} className="border-b border-bg-border/50 hover:bg-bg-hover/40">
                      <td className="px-4 py-3">{fmtMonth(m.mes)}</td>
                      <td className={`px-4 py-3 text-right num ${colorForValue(m.rentabilidad_pct)}`}>{formatPct(m.rentabilidad_pct)}</td>
                      <td className={`px-4 py-3 text-right num ${colorForValue(m.rentabilidad_clp)}`}>{formatCLP(m.rentabilidad_clp, { sign: true })}</td>
                      <td className="px-4 py-3 text-right num text-muted">{formatCLP(m.aportes_netos_clp)}</td>
                    </tr>
                  ))}
                  {monthly.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-10 text-center text-muted">Sin datos mensuales en el rango.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
