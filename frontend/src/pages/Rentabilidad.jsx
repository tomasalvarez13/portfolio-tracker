import { useEffect, useState, useCallback } from 'react';
import { getRentabilidad, getMonthlyRentabilidad } from '../services/api';
import { formatCLP, formatPct, colorForValue } from '../utils/formatters';
import { StatCard } from '../components/ui/Card.jsx';
import { Spinner, ErrorBox } from '../components/ui/Spinner.jsx';

// Rango por defecto: año actual
const yearStart = `${new Date().getFullYear()}-01-01`;
const today = new Date().toISOString().slice(0, 10);

export default function Rentabilidad() {
  const [from, setFrom] = useState(yearStart);
  const [to, setTo] = useState(today);
  const [rent, setRent] = useState(null);
  const [monthly, setMonthly] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [r, m] = await Promise.all([
        getRentabilidad({ from, to }),
        getMonthlyRentabilidad({ from, to }),
      ]);
      setRent(r); setMonthly(m);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const MONTH_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const fmtMonth = (ym) => {
    const [y, m] = ym.split('-');
    return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
  };

  return (
    <div className="space-y-6">
      <h2 className="text-lg lg:text-xl font-semibold">Rentabilidad</h2>

      {/* Rango de fechas */}
      <div className="card p-4 flex flex-col sm:flex-row flex-wrap items-start sm:items-end gap-3">
        <div>
          <label className="text-xs text-muted">Desde</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="mt-1 block bg-bg-base border border-bg-border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-xs text-muted">Hasta</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="mt-1 block bg-bg-base border border-bg-border rounded-lg px-3 py-2 text-sm" />
        </div>
        <button onClick={load} className="px-4 py-2 rounded-lg text-sm bg-accent hover:bg-accent/90 text-white">Aplicar</button>
      </div>

      {error && <ErrorBox message={error} />}
      {loading ? <Spinner /> : rent?.error ? (
        <div className="card p-5 text-muted text-sm">{rent.error}. Necesitas snapshots dentro del rango.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">
            <StatCard label="Rentabilidad total"
              value={formatPct(rent?.rentabilidad_total_pct)}
              sub={formatCLP(rent?.rentabilidad_total_clp, { sign: true })}
              valueClass={colorForValue(rent?.rentabilidad_total_pct)} />
            <StatCard label="Sobre lo invertido"
              value={formatPct(rent?.rentabilidad_sobre_invertido_pct)}
              sub={formatCLP(rent?.rentabilidad_sobre_invertido_clp, { sign: true })}
              valueClass={colorForValue(rent?.rentabilidad_sobre_invertido_pct)} />
            <StatCard label="Aportes netos del período"
              value={formatCLP(rent?.aportes_netos_clp)}
              sub={`Aportes ${formatCLP(rent?.aportes_periodo_clp)} · Retiros ${formatCLP(rent?.retiros_periodo_clp)}`} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <StatCard label="Valor inicial" value={formatCLP(rent?.valor_inicial_clp)} />
            <StatCard label="Valor final" value={formatCLP(rent?.valor_final_clp)} />
          </div>

          {/* Tabla mensual */}
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
                {monthly.map((m) => (
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
