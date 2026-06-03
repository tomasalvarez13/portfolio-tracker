import { useState, useMemo } from 'react';
import { formatCLP, formatUSD, formatPct, colorForValue } from '../../utils/formatters';

const PERIODS = [
  { key: 'hoy',    label: 'Hoy'     },
  { key: 'mes',    label: 'Mes'     },
  { key: 'ano',    label: 'Año'     },
  { key: 'inicio', label: 'Inicio'  },
];

function findClosestSnapshot(snapshots, targetDate) {
  const target = targetDate.toISOString().slice(0, 10);
  const before = snapshots.filter(s => s.date <= target);
  return before.length ? before[before.length - 1] : snapshots[0];
}

export default function EvolutionPeriodCard({ snapshots, summary, currency = 'CLP' }) {
  const [period, setPeriod] = useState('hoy');

  const result = useMemo(() => {
    if (!snapshots?.length) return null;

    const last = snapshots[snapshots.length - 1];
    const now  = new Date();

    if (period === 'hoy') {
      return {
        changeClp: summary?.change_clp,
        changePct: summary?.change_pct,
        from: summary?.prev_date?.slice(0, 10),
        to:   last.date,
      };
    }

    let startDate;
    if (period === 'mes') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (period === 'ano') {
      startDate = new Date(now.getFullYear(), 0, 1);
    } else {
      startDate = new Date(snapshots[0].date);
    }

    const startSnap = findClosestSnapshot(snapshots, startDate);
    if (!startSnap) return null;

    const viClp = startSnap.total_clp;
    const vfClp = last.total_clp;
    const viUsd = startSnap.total_usd;
    const vfUsd = last.total_usd;

    const changeClp = vfClp - viClp;
    const changePct = viClp > 0 ? (changeClp / viClp) * 100 : null;
    const changeUsd = vfUsd - viUsd;

    return { changeClp, changePct, changeUsd, from: startSnap.date, to: last.date };
  }, [period, snapshots, summary, currency]);

  const change  = result ? (currency === 'CLP' ? result.changeClp : (result.changeUsd ?? result.changeClp)) : null;
  const pct     = result?.changePct;
  const isPos   = (change ?? 0) >= 0;
  const fmtVal  = currency === 'CLP' ? formatCLP : formatUSD;

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <span className="text-xs text-muted uppercase tracking-wide">Evolución</span>
        <div className="flex gap-1 bg-bg-base rounded-lg p-1">
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              className={`px-3 py-1 rounded-md text-xs transition-colors ${
                period === p.key
                  ? 'bg-accent/20 text-accent font-medium'
                  : 'text-muted hover:text-gray-200'
              }`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {result ? (
        <>
          <div className={`text-2xl font-semibold num ${colorForValue(change)}`}>
            {change != null ? fmtVal(change, { sign: true }) : '—'}
          </div>
          <div className={`mt-1 flex items-center gap-2 text-sm num ${colorForValue(pct)}`}>
            <span className="text-base">{isPos ? '▲' : '▼'}</span>
            <span>{pct != null ? formatPct(Math.abs(pct), { sign: false }) : '—'}</span>
          </div>
          {result.from && (
            <div className="mt-2 text-xs text-muted">
              {result.from.slice(0, 10)} → {result.to?.slice(0, 10)}
            </div>
          )}
        </>
      ) : (
        <div className="text-muted text-sm py-4">Sin datos suficientes</div>
      )}
    </div>
  );
}
