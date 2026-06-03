import { useState, useEffect, useMemo } from 'react';
import { getTWR } from '../../services/api';
import { formatCLP, formatUSD, formatPct, colorForValue } from '../../utils/formatters';

const PERIODS = [
  { key: '1s',  label: '1S'           },
  { key: '1m',  label: '1M'           },
  { key: 'mtd', label: 'MTD'          },
  { key: 'apt', label: 'Últ aporte'   },
  { key: 'ytd', label: 'YTD'          },
  { key: '1a',  label: '1A'           },
];

function toISO(d) { return d.toISOString().slice(0, 10); }

function findClosestSnapshot(snapshots, targetISO) {
  const before = snapshots.filter(s => s.date <= targetISO);
  return before.length ? before[before.length - 1] : snapshots[0];
}

function getRangeForPeriod(period, snapshots, aportes) {
  if (!snapshots?.length) return null;
  const last = snapshots[snapshots.length - 1];
  const now  = new Date();
  let startISO;

  switch (period) {
    case '1s':  { const d = new Date(now); d.setDate(d.getDate() - 7);   startISO = toISO(d); break; }
    case '1m':  { const d = new Date(now); d.setMonth(d.getMonth() - 1); startISO = toISO(d); break; }
    case 'mtd': { startISO = toISO(new Date(now.getFullYear(), now.getMonth(), 1)); break; }
    case 'ytd': { startISO = toISO(new Date(now.getFullYear(), 0, 1)); break; }
    case '1a':  { const d = new Date(now); d.setFullYear(d.getFullYear() - 1); startISO = toISO(d); break; }
    case 'apt': {
      if (!aportes?.length) return null;
      const lastAporte = [...aportes].sort((a, b) => a.date.localeCompare(b.date)).pop();
      startISO = lastAporte.date;
      break;
    }
    default: startISO = snapshots[0].date;
  }

  const startSnap = findClosestSnapshot(snapshots, startISO);
  return { from: startSnap.date, to: last.date, fromSnap: startSnap, toSnap: last };
}

export default function EvolutionPeriodCard({ snapshots, aportes = [], currency = 'CLP' }) {
  const [period, setPeriod] = useState('mtd');
  const [twr, setTwr]       = useState(null);
  const [loadingTwr, setLoadingTwr] = useState(false);

  const range = useMemo(
    () => getRangeForPeriod(period, snapshots, aportes),
    [period, snapshots, aportes]
  );

  // Cálculo del crecimiento total
  const growth = useMemo(() => {
    if (!range) return null;
    const { fromSnap, toSnap } = range;
    const isCLP = currency === 'CLP';
    const vi = isCLP ? fromSnap.total_clp : fromSnap.total_usd;
    const vf = isCLP ? toSnap.total_clp   : toSnap.total_usd;
    const changeClp = toSnap.total_clp - fromSnap.total_clp;
    const changeUsd = toSnap.total_usd - fromSnap.total_usd;
    const change    = isCLP ? changeClp : changeUsd;
    const pct       = vi > 0 ? (vf - vi) / vi * 100 : null;
    return { change, pct, viClp: fromSnap.total_clp, vfClp: toSnap.total_clp };
  }, [range, currency]);

  // Aportes netos del período (CLP)
  const aportesNeto = useMemo(() => {
    if (!range || !aportes?.length) return 0;
    return aportes
      .filter(a => a.date > range.from && a.date <= range.to)
      .reduce((s, a) => s + Number(a.amount || 0), 0);
  }, [range, aportes]);

  // Fetch TWR del backend
  useEffect(() => {
    if (!range) return;
    setLoadingTwr(true);
    getTWR({ from: range.from, to: range.to })
      .then(setTwr)
      .catch(() => setTwr(null))
      .finally(() => setLoadingTwr(false));
  }, [range]);

  const fmtVal = currency === 'CLP' ? formatCLP : formatUSD;

  return (
    <div className="card p-5">
      {/* Tabs período */}
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <span className="text-xs text-muted uppercase tracking-wide">Evolución</span>
      </div>
      <div className="flex flex-wrap gap-1 bg-bg-base rounded-lg p-1 mb-4">
        {PERIODS.map(p => (
          <button key={p.key} onClick={() => setPeriod(p.key)}
            className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
              period === p.key
                ? 'bg-accent/20 text-accent font-medium'
                : 'text-muted hover:text-gray-200'
            }`}>
            {p.label}
          </button>
        ))}
      </div>

      {range ? (
        <>
          {/* Crecimiento total */}
          <div>
            <div className="text-[10px] text-muted uppercase tracking-wide mb-0.5">Crecimiento total</div>
            <div className={`text-xl font-semibold num ${colorForValue(growth?.change)}`}>
              {growth?.change != null ? fmtVal(growth.change, { sign: true }) : '—'}
            </div>
            <div className={`text-xs num ${colorForValue(growth?.pct)}`}>
              {growth?.pct != null ? formatPct(growth.pct) : '—'}
            </div>
          </div>

          {/* Rentabilidad real TWR */}
          <div className="mt-3 pt-3 border-t border-bg-border">
            <div className="text-[10px] text-muted uppercase tracking-wide mb-0.5">
              Rentabilidad real <span className="opacity-70">(TWR)</span>
            </div>
            <div className={`text-xl font-semibold num ${colorForValue(twr?.twr_pct)}`}>
              {loadingTwr ? '…' : (twr?.twr_pct != null ? formatPct(twr.twr_pct) : '—')}
            </div>
            <div className={`text-xs num ${colorForValue(twr?.twr_clp_aprox)}`}>
              {twr?.twr_clp_aprox != null ? `≈ ${formatCLP(twr.twr_clp_aprox, { sign: true })}` : ''}
            </div>
          </div>

          {/* Aportes del período */}
          {aportesNeto > 0 && (
            <div className="mt-3 pt-3 border-t border-bg-border text-xs text-muted">
              Aportado en el período: <span className="num text-gray-300">{formatCLP(aportesNeto)}</span>
            </div>
          )}

          <div className="mt-2 text-[10px] text-muted">
            {range.from} → {range.to}
          </div>
        </>
      ) : (
        <div className="text-muted text-sm py-4">Sin datos suficientes</div>
      )}
    </div>
  );
}
