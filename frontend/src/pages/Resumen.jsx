import { useState } from 'react';
import { getSummary, getSnapshots, getBreakdown, getMovements } from '../services/api';
import { formatCLP, formatUSD, formatDate } from '../utils/formatters';
import { StatCard } from '../components/ui/Card.jsx';
import { Spinner, ErrorBox } from '../components/ui/Spinner.jsx';
import EvolutionChart from '../components/summary/EvolutionChart.jsx';
import EvolutionPeriodCard from '../components/summary/EvolutionPeriodCard.jsx';
import BreakdownChart from '../components/summary/BreakdownChart.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { usePersistedFetch } from '../hooks/usePersistedFetch.js';

const fetchResumen = async () => {
  const [s, snap, bd, mov] = await Promise.all([
    getSummary(), getSnapshots(), getBreakdown(),
    getMovements({ type: 'aporte' }),
  ]);
  return {
    summary:   s,
    snapshots: snap,
    breakdown: bd,
    aportes:   mov.filter(m => !m.instrument_id)
                  .map(m => ({ date: m.date?.slice(0, 10), amount: Number(m.amount_clp) })),
  };
};

export default function Resumen() {
  const { user } = useAuth();
  const { data, loading, syncing, error } =
    usePersistedFetch(user?.id ? `resumen_${user.id}` : null, fetchResumen);

  const [currency,    setCurrency]    = useState('CLP');
  const [selectedDay, setSelectedDay] = useState(null);

  const summary   = data?.summary   ?? null;
  const snapshots = data?.snapshots ?? [];
  const breakdown = data?.breakdown ?? [];
  const aportes   = data?.aportes   ?? [];

  if (loading) return <Spinner />;
  if (error && !data) return <ErrorBox message={error.response?.data?.error || error.message} />;

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* Cabecera */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg lg:text-xl font-semibold">Resumen</h2>
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

      {/* Tarjetas métricas — 2 col mobile, 3 col desktop */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">
        <StatCard
          label="Patrimonio total"
          value={currency === 'CLP' ? formatCLP(summary?.total_clp) : formatUSD(summary?.total_usd)}
          sub={summary?.price_date ? `al ${formatDate(summary.price_date)}` : null}
        />
        <StatCard
          label={currency === 'CLP' ? 'En USD' : 'En CLP'}
          value={currency === 'CLP' ? formatUSD(summary?.total_usd) : formatCLP(summary?.total_clp)}
        />
        {/* Tarjeta evolución con períodos — ocupa full en mobile */}
        <div className="col-span-2 lg:col-span-1">
          <EvolutionPeriodCard
            snapshots={snapshots}
            summary={summary}
            currency={currency}
          />
        </div>
      </div>

      {/* Gráfico evolutivo */}
      <EvolutionChart
        snapshots={snapshots}
        aportes={aportes}
        currency={currency}
        onPointClick={setSelectedDay}
      />

      {/* Detalle de día seleccionado */}
      {selectedDay && (
        <div className="card p-4 lg:p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium text-sm lg:text-base">Detalle del {formatDate(selectedDay.date)}</h3>
            <button onClick={() => setSelectedDay(null)}
              className="text-xs text-muted hover:text-gray-200 px-2 py-1 rounded hover:bg-bg-hover">
              × cerrar
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted mb-0.5">CLP</div>
              <div className="num font-medium">{formatCLP(selectedDay.total_clp)}</div>
            </div>
            <div>
              <div className="text-xs text-muted mb-0.5">USD</div>
              <div className="num font-medium">{formatUSD(selectedDay.total_usd)}</div>
            </div>
          </div>
          {selectedDay.breakdown && Object.keys(selectedDay.breakdown).length > 0 && (
            <div className="mt-3 pt-3 border-t border-bg-border grid grid-cols-2 sm:grid-cols-3 gap-2">
              {Object.entries(selectedDay.breakdown).map(([type, v]) => (
                <div key={type} className="text-xs">
                  <div className="text-muted mb-0.5">{type.replace('_', ' ')}</div>
                  <div className="num">{formatCLP(v.clp)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Donut */}
      <BreakdownChart breakdown={breakdown} />
    </div>
  );
}
