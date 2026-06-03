import { useState, useMemo, useEffect } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
  CartesianGrid, ReferenceLine, ReferenceArea,
} from 'recharts';
import { getTWR } from '../../services/api';
import { formatCLP, formatUSD, formatPct, formatDate, colorForValue } from '../../utils/formatters';

// ---- Selector de rango ----
const RANGE_BUTTONS = [
  { key: '1m',  label: '1M'         },
  { key: '3m',  label: '3M'         },
  { key: '6m',  label: '6M'         },
  { key: 'mtd', label: 'MTD'        },
  { key: 'ytd', label: 'YTD'        },
  { key: 'apt', label: 'Últ aporte' },
  { key: '1a',  label: '1A'         },
  { key: 'all', label: 'Todo'       },
];

function toISO(d) { return d.toISOString().slice(0, 10); }

function filterByRange(snapshots, key, aportes) {
  if (!snapshots?.length || key === 'all') return snapshots;
  const now = new Date();
  let startISO;
  switch (key) {
    case '1m':  { const d = new Date(now); d.setMonth(d.getMonth() - 1);     startISO = toISO(d); break; }
    case '3m':  { const d = new Date(now); d.setMonth(d.getMonth() - 3);     startISO = toISO(d); break; }
    case '6m':  { const d = new Date(now); d.setMonth(d.getMonth() - 6);     startISO = toISO(d); break; }
    case '1a':  { const d = new Date(now); d.setFullYear(d.getFullYear()-1); startISO = toISO(d); break; }
    case 'mtd': { startISO = toISO(new Date(now.getFullYear(), now.getMonth(), 1)); break; }
    case 'ytd': { startISO = toISO(new Date(now.getFullYear(), 0, 1));              break; }
    case 'apt': {
      if (!aportes?.length) return snapshots;
      const last = [...aportes].sort((a,b) => a.date.localeCompare(b.date)).pop();
      startISO = last.date;
      break;
    }
    default: return snapshots;
  }
  return snapshots.filter(s => s.date >= startISO);
}

// ---- Tooltip personalizado ----
function CustomTooltip({ active, payload, label, currency, aportes, rangeData, isDragging }) {
  if (isDragging || rangeData) {
    // Modo "selección de rango" — mostrar resumen del rango
    if (!rangeData) return null;
    const fmt = currency === 'CLP' ? formatCLP : formatUSD;
    return (
      <div className="bg-bg-card border border-bg-border rounded-xl px-4 py-3 shadow-xl text-xs space-y-1.5 min-w-[180px]">
        <div className="text-muted text-[10px]">
          {formatDate(rangeData.from)} → {formatDate(rangeData.to)}
        </div>
        <div>
          <div className="text-[10px] text-muted">Crecimiento total</div>
          <div className={`text-sm font-semibold num ${colorForValue(rangeData.change)}`}>
            {fmt(rangeData.change, { sign: true })}
          </div>
          <div className={`text-[11px] num ${colorForValue(rangeData.pct)}`}>
            {formatPct(rangeData.pct)}
          </div>
        </div>
        {rangeData.twr != null && (
          <div className="pt-1.5 border-t border-bg-border">
            <div className="text-[10px] text-muted">Rentabilidad real (TWR)</div>
            <div className={`text-sm font-semibold num ${colorForValue(rangeData.twr)}`}>
              {formatPct(rangeData.twr)}
            </div>
          </div>
        )}
        {rangeData.aportesNeto > 0 && (
          <div className="text-[10px] text-muted pt-1 border-t border-bg-border">
            Aportes período: <span className="num text-gray-300">{formatCLP(rangeData.aportesNeto)}</span>
          </div>
        )}
      </div>
    );
  }

  // Modo normal — mostrar punto
  if (!active || !payload?.length) return null;
  const value  = payload[0]?.value;
  const fmt    = currency === 'CLP' ? formatCLP : formatUSD;
  const aporte = aportes.find(a => a.date === label);
  return (
    <div className="bg-bg-card border border-bg-border rounded-xl px-4 py-3 shadow-xl text-xs space-y-1">
      <div className="text-muted">{formatDate(label)}</div>
      <div className="text-base font-semibold num">{fmt(value)}</div>
      {aporte && (
        <div className="text-gain flex items-center gap-1.5 pt-1 border-t border-bg-border">
          <span>↑</span><span>Aporte {fmt(aporte.amount)}</span>
        </div>
      )}
    </div>
  );
}

export default function EvolutionChart({ snapshots, aportes = [], currency = 'CLP', onPointClick, onRangeChange, defaultRange = 'all' }) {
  const [range, setRange]       = useState(defaultRange);
  const [refLeft, setRefLeft]   = useState(null);   // inicio drag
  const [refRight, setRefRight] = useState(null);   // fin drag
  const [selectedRange, setSelectedRange] = useState(null); // { from, to } persistente
  const [twrSelected, setTwrSelected] = useState(null);

  const filteredSnaps = useMemo(
    () => filterByRange(snapshots, range, aportes),
    [snapshots, range, aportes]
  );

  // Emitir cambio del rango efectivo al padre.
  // Si hay selección persistente (drag), gana sobre el filtro del selector.
  useEffect(() => {
    if (!onRangeChange) return;
    if (selectedRange) {
      onRangeChange({ from: selectedRange.from, to: selectedRange.to, source: 'drag' });
    } else if (filteredSnaps.length >= 2) {
      onRangeChange({
        from: filteredSnaps[0].date,
        to: filteredSnaps[filteredSnaps.length - 1].date,
        source: 'selector',
      });
    }
  }, [selectedRange, filteredSnaps, onRangeChange]);

  const rawData = filteredSnaps.map(s => ({
    date: s.date,
    value: currency === 'CLP' ? s.total_clp : s.total_usd,
    raw: s,
  }));

  // Con un solo punto Recharts no dibuja nada — añadimos un punto virtual
  // "ayer" al mismo valor para mostrar una línea plana significativa.
  const data = rawData.length === 1 ? [
    { date: (() => { const d = new Date(rawData[0].date); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })(),
      value: rawData[0].value, raw: rawData[0].raw, _virtual: true },
    rawData[0],
  ] : rawData;

  const fmtFn  = currency === 'CLP' ? formatCLP : formatUSD;
  const maxVal = data.length ? Math.max(...data.map(d => d.value)) : 1;
  const minVal = data.length ? Math.min(...data.map(d => d.value)) : 0;

  const significantAportes = aportes.filter(a => a.amount >= 500_000);

  // Datos del rango seleccionado (drag persistente)
  const rangeData = useMemo(() => {
    if (!selectedRange) return null;
    const fromSnap = snapshots.find(s => s.date === selectedRange.from);
    const toSnap   = snapshots.find(s => s.date === selectedRange.to);
    if (!fromSnap || !toSnap) return null;
    const isCLP = currency === 'CLP';
    const vi = isCLP ? fromSnap.total_clp : fromSnap.total_usd;
    const vf = isCLP ? toSnap.total_clp   : toSnap.total_usd;
    const aportesNeto = aportes
      .filter(a => a.date > selectedRange.from && a.date <= selectedRange.to)
      .reduce((s, a) => s + Number(a.amount || 0), 0);
    return {
      from: selectedRange.from,
      to: selectedRange.to,
      change: vf - vi,
      pct: vi > 0 ? (vf - vi) / vi * 100 : null,
      twr: twrSelected?.twr_pct ?? null,
      aportesNeto,
    };
  }, [selectedRange, snapshots, currency, aportes, twrSelected]);

  // Fetch TWR para el rango seleccionado
  useEffect(() => {
    if (!selectedRange) { setTwrSelected(null); return; }
    getTWR({ from: selectedRange.from, to: selectedRange.to })
      .then(setTwrSelected)
      .catch(() => setTwrSelected(null));
  }, [selectedRange]);

  // Handlers de drag
  function onMouseDown(e) {
    if (!e?.activeLabel) return;
    setRefLeft(e.activeLabel);
    setRefRight(null);
  }
  function onMouseMove(e) {
    if (refLeft && e?.activeLabel) setRefRight(e.activeLabel);
  }
  function onMouseUp(e) {
    if (refLeft && refRight && refLeft !== refRight) {
      const [from, to] = [refLeft, refRight].sort();
      setSelectedRange({ from, to });
    } else if (e?.activePayload?.[0]?.payload?.raw && onPointClick) {
      // Click simple (sin drag) — comportamiento original
      onPointClick(e.activePayload[0].payload.raw);
    }
    setRefLeft(null);
    setRefRight(null);
  }

  function clearSelection() {
    setSelectedRange(null);
    setTwrSelected(null);
  }

  // Ticks X
  const tickDates = data.filter((_, i) =>
    i === 0 || data[i].date.slice(0, 7) !== data[i - 1].date.slice(0, 7)
  ).map(d => d.date);

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h3 className="font-medium">Evolución del patrimonio</h3>
        <span className="text-xs text-muted">
          {data.length} puntos
          {data.length > 0 && ` · desde ${formatDate(data[0].date)}`}
        </span>
      </div>

      {/* Selector de rango */}
      <div className="flex flex-wrap gap-1 bg-bg-base rounded-lg p-1 mb-3 w-fit">
        {RANGE_BUTTONS.map(b => (
          <button key={b.key} onClick={() => setRange(b.key)}
            className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
              range === b.key
                ? 'bg-accent/20 text-accent font-medium'
                : 'text-muted hover:text-gray-200'
            }`}>
            {b.label}
          </button>
        ))}
      </div>

      {/* Banner de rango seleccionado */}
      {selectedRange && (
        <div className="mb-3 flex items-center justify-between gap-3 px-3 py-2 bg-accent/10 border border-accent/30 rounded-lg text-xs">
          <span className="text-accent">
            Rango: <span className="num">{formatDate(selectedRange.from)} → {formatDate(selectedRange.to)}</span>
          </span>
          <button onClick={clearSelection} className="text-muted hover:text-gray-200">× limpiar</button>
        </div>
      )}

      {data.length === 0 ? (
        <div className="py-16 text-center space-y-2">
          <p className="text-sm text-muted">Sin datos en este rango.</p>
          <p className="text-xs text-muted/60">Probá seleccionar "Todo" o un rango más amplio.</p>
        </div>
      ) : rawData.length === 1 ? (
        // Un solo punto: mostrar valor actual + mensaje explicativo encima del gráfico
        <div>
          <div className="mb-4 px-1 flex items-center gap-3">
            <div>
              <p className="text-xs text-muted">Valor actual</p>
              <p className="text-xl font-semibold num">{fmtFn(rawData[0].value)}</p>
            </div>
            <p className="text-xs text-muted/70 max-w-xs">
              Empezaste a registrar hoy — el gráfico irá mostrando la evolución a medida que pasen los días.
            </p>
          </div>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart
            data={data}
            margin={{ top: 10, right: 8, left: 0, bottom: 0 }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
          >
            <defs>
              <linearGradient id="gradPatrimonio" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="#1f2630" vertical={false} />

            <XAxis
              dataKey="date" ticks={tickDates}
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
              content={
                <CustomTooltip
                  currency={currency}
                  aportes={aportes.map(a => ({ date: a.date, amount: a.amount }))}
                  rangeData={rangeData}
                  isDragging={refLeft && refRight}
                />
              }
              cursor={{ stroke: '#3b82f6', strokeWidth: 1, strokeDasharray: '4 2' }}
            />

            {/* Aportes significativos */}
            {significantAportes.map(a => (
              <ReferenceLine key={a.date} x={a.date}
                stroke="#22c55e" strokeWidth={1} strokeDasharray="3 3" strokeOpacity={0.4} />
            ))}

            {/* Área de selección (drag temporal) */}
            {refLeft && refRight && (
              <ReferenceArea x1={refLeft} x2={refRight} strokeOpacity={0.3} fill="#3b82f6" fillOpacity={0.1} />
            )}

            {/* Área de selección persistente */}
            {selectedRange && (
              <ReferenceArea x1={selectedRange.from} x2={selectedRange.to}
                strokeOpacity={0.4} stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.08} />
            )}

            <Area
              type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2}
              fill="url(#gradPatrimonio)" dot={false}
              activeDot={{ r: 4, fill: '#3b82f6', stroke: '#0d1117', strokeWidth: 2, cursor: 'pointer' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}

      <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-muted flex-wrap">
        <div className="flex items-center gap-2">
          <span className="inline-block w-6 border-t border-dashed border-gain opacity-60" />
          <span>Aporte</span>
        </div>
        <span>💡 Arrastra sobre el gráfico para ver rentabilidad de un rango</span>
      </div>
    </div>
  );
}
