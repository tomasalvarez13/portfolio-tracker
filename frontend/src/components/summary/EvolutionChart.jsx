import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
  CartesianGrid, ReferenceLine, Legend,
} from 'recharts';
import { formatCLP, formatUSD, formatDate } from '../../utils/formatters';

// Tooltip personalizado
function CustomTooltip({ active, payload, label, currency, aportes }) {
  if (!active || !payload?.length) return null;
  const value = payload[0]?.value;
  const fmt = currency === 'CLP' ? formatCLP : formatUSD;
  const aporte = aportes.find(a => a.date === label);
  return (
    <div className="bg-bg-card border border-bg-border rounded-xl px-4 py-3 shadow-xl text-xs space-y-1">
      <div className="text-muted">{formatDate(label)}</div>
      <div className="text-base font-semibold num">{fmt(value)}</div>
      {aporte && (
        <div className="text-gain flex items-center gap-1.5 pt-1 border-t border-bg-border">
          <span>↑</span>
          <span>Aporte {fmt(aporte.amount)}</span>
        </div>
      )}
    </div>
  );
}

export default function EvolutionChart({ snapshots, aportes = [], currency = 'CLP', onPointClick }) {
  const data = snapshots.map(s => ({
    date: s.date,
    value: currency === 'CLP' ? s.total_clp : s.total_usd,
    raw: s,
  }));

  const fmt   = currency === 'CLP' ? formatCLP : formatUSD;
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const minVal = Math.min(...data.map(d => d.value), 0);

  // Solo aportes grandes (≥ 500k CLP o equivalente) para no saturar el gráfico
  const significantAportes = aportes.filter(a => a.amount >= 500_000);

  // Ticks del eje X: uno por mes aprox
  const tickDates = data.filter((_, i) => i === 0 || data[i].date.slice(0,7) !== data[i-1].date.slice(0,7)).map(d => d.date);

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-medium">Evolución del patrimonio</h3>
        <span className="text-xs text-muted">{data.length} puntos · desde {formatDate(data[0]?.date)}</span>
      </div>

      {data.length === 0 ? (
        <div className="text-muted text-sm py-16 text-center">
          Sin datos históricos aún.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart
            data={data}
            margin={{ top: 10, right: 8, left: 0, bottom: 0 }}
            onClick={e => {
              const p = e?.activePayload?.[0]?.payload?.raw;
              if (p && onPointClick) onPointClick(p);
            }}
          >
            <defs>
              <linearGradient id="gradPatrimonio" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="#1f2630" vertical={false} />

            <XAxis
              dataKey="date"
              ticks={tickDates}
              tickFormatter={d => {
                const [y, m] = d.split('-');
                return `${['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][+m-1]} ${y.slice(2)}`;
              }}
              stroke="transparent"
              tick={{ fill: '#8b949e', fontSize: 11 }}
              minTickGap={30}
            />

            <YAxis
              stroke="transparent"
              tick={{ fill: '#8b949e', fontSize: 11 }}
              tickFormatter={v =>
                currency === 'CLP'
                  ? `$${(v / 1_000_000).toFixed(0)}M`
                  : `$${(v / 1_000).toFixed(0)}K`
              }
              width={52}
              domain={[minVal * 0.97, maxVal * 1.03]}
            />

            <Tooltip
              content={<CustomTooltip currency={currency} aportes={aportes.map(a => ({ date: a.date, amount: a.amount }))} />}
              cursor={{ stroke: '#3b82f6', strokeWidth: 1, strokeDasharray: '4 2' }}
            />

            {/* Líneas verticales para aportes significativos */}
            {significantAportes.map(a => (
              <ReferenceLine
                key={a.date}
                x={a.date}
                stroke="#22c55e"
                strokeWidth={1}
                strokeDasharray="3 3"
                strokeOpacity={0.5}
                label={false}
              />
            ))}

            <Area
              type="monotone"
              dataKey="value"
              stroke="#3b82f6"
              strokeWidth={2}
              fill="url(#gradPatrimonio)"
              dot={false}
              activeDot={{ r: 4, fill: '#3b82f6', stroke: '#0d1117', strokeWidth: 2, cursor: 'pointer' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}

      {/* Leyenda manual */}
      {significantAportes.length > 0 && (
        <div className="flex items-center gap-2 mt-3 text-xs text-muted">
          <span className="inline-block w-8 border-t border-dashed border-gain opacity-60" />
          <span>Aporte</span>
        </div>
      )}
    </div>
  );
}
