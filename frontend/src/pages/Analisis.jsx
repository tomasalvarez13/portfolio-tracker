import { useState, useEffect, useCallback } from 'react';
import { getAnalyticsByCustodian, getAnalyticsByInstrument } from '../services/api';
import { formatCLP, formatPct, formatDate, colorForValue, CATEGORY_LABELS, categoryOf } from '../utils/formatters';
import { Spinner, ErrorBox } from '../components/ui/Spinner.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { Building2, Package, AlertTriangle } from 'lucide-react';

// Rentabilidad por custodio y por activo.
//
// Los flujos de cada bucket se derivan del cambio de unidades entre días: el
// precio mueve el valor, no las unidades. Una posición cargada por monto no
// permite esa separación, y en ese caso el backend devuelve `twr_pct` en null en
// vez de un número inventado — acá eso se muestra como "—" con su explicación.

const RANGOS = [
  { key: '30d',  label: '30 días', dias: 30 },
  { key: '90d',  label: '90 días', dias: 90 },
  { key: '180d', label: '6 meses', dias: 180 },
  { key: 'todo', label: 'Todo',    dias: null },
];

const restarDias = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - n * 86400000).toISOString().slice(0, 10);
};

// Barra proporcional al valor, para leer la distribución sin un gráfico aparte.
function Barra({ pct }) {
  return (
    <div className="h-1.5 rounded-full bg-bg-hover overflow-hidden">
      <div className="h-full bg-accent/60 rounded-full" style={{ width: `${Math.max(pct, 1)}%` }} />
    </div>
  );
}

function Tabla({ data, agrupacion }) {
  const total = data.total_final_clp || 0;
  const buckets = data.buckets || [];

  if (buckets.length === 0) {
    return (
      <div className="card p-10 text-center text-muted text-sm">
        No hay datos en este rango.
      </div>
    );
  }

  const sinEstimar = buckets.filter((b) => !b.flujos_estimados).length;
  const conStale   = buckets.filter((b) => b.dias_stale > 0).length;

  return (
    <div className="space-y-3">
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[680px]">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-bg-border">
                <th className="px-5 py-3 font-medium">{agrupacion === 'custodio' ? 'Custodio' : 'Activo'}</th>
                <th className="px-4 py-3 font-medium text-right">Valor inicial</th>
                <th className="px-4 py-3 font-medium text-right">Aportes</th>
                <th className="px-4 py-3 font-medium text-right">Retiros</th>
                <th className="px-4 py-3 font-medium text-right">Valor final</th>
                <th className="px-4 py-3 font-medium text-right">Rentabilidad</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => {
                const pct = total > 0 ? ((b.valor_final_clp || 0) / total) * 100 : 0;
                return (
                  <tr key={b.key} className="border-b border-bg-border/40 last:border-0 hover:bg-bg-hover/30">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{b.label}</span>
                        {b.ticker && <span className="text-xs text-muted">{b.ticker}</span>}
                        {b.dias_stale > 0 && (
                          <span title={`${b.dias_stale} de ${b.dias} días se valorizaron con un precio arrastrado`}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-muted">
                            {b.dias_stale}d sin precio
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 max-w-[180px]"><Barra pct={pct} /></div>
                      <div className="text-[10px] text-muted mt-0.5">
                        {formatPct(pct, { sign: false })} del total
                        {b.type ? ` · ${CATEGORY_LABELS[categoryOf(b.type)] || b.type}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right num text-muted">{formatCLP(b.valor_inicial_clp)}</td>
                    <td className="px-4 py-3 text-right num text-muted">
                      {b.aportes_clp > 0 ? formatCLP(b.aportes_clp) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right num text-muted">
                      {b.retiros_clp > 0 ? formatCLP(b.retiros_clp) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right num font-medium">{formatCLP(b.valor_final_clp)}</td>
                    <td className="px-4 py-3 text-right num">
                      {b.twr_pct == null ? (
                        <span className="text-muted" title="No se puede separar aportes de rentabilidad: la posición está cargada por monto, no por unidades">
                          —
                        </span>
                      ) : (
                        <span className={colorForValue(b.twr_pct)}>{formatPct(b.twr_pct)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {(sinEstimar > 0 || conStale > 0) && (
        <div className="card p-4 space-y-2 text-xs text-muted">
          {sinEstimar > 0 && (
            <div className="flex gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5 text-muted" />
              <p>
                {sinEstimar} {sinEstimar === 1 ? 'fila no muestra' : 'filas no muestran'} rentabilidad.
                Para calcularla hay que poder separar lo que aportaste de lo que se movió por precio, y eso
                sale de comparar <span className="text-gray-200">unidades</span> entre días. Una posición
                cargada por monto no lo permite: preferimos no mostrar nada antes que un número inventado.
              </p>
            </div>
          )}
          {conStale > 0 && (
            <div className="flex gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5 text-muted" />
              <p>
                {conStale} {conStale === 1 ? 'fila tiene' : 'filas tienen'} días valorizados con un precio
                arrastrado del día anterior. El total del período es correcto, pero la rentabilidad diaria
                de esos tramos aparece concentrada en el día que el precio real volvió.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Analisis() {
  const { user } = useAuth();
  const [tab, setTab]         = useState('custodio');
  const [rango, setRango]     = useState('90d');
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const fn = tab === 'custodio' ? getAnalyticsByCustodian : getAnalyticsByInstrument;
      // Sin rango explícito el backend usa lo que haya; con rango, se acota.
      let params;
      if (rango !== 'todo') {
        const dias = RANGOS.find((r) => r.key === rango).dias;
        const prim = await fn({});
        const hasta = prim.disponible?.hasta;
        if (hasta) params = { from: restarDias(hasta, dias), to: hasta };
        setData(params ? await fn(params) : prim);
      } else {
        const d = await fn({});
        setData(d.disponible?.desde
          ? await fn({ from: d.disponible.desde, to: d.disponible.hasta })
          : d);
      }
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setLoading(false); }
  }, [tab, rango]);

  useEffect(() => { if (user?.id) load(); }, [load, user?.id]);

  const disp = data?.disponible;

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg lg:text-xl font-semibold">Análisis</h2>
          {data?.from && (
            <p className="text-xs text-muted mt-0.5">
              {formatDate(data.from)} — {formatDate(data.to)}
            </p>
          )}
        </div>
        <div className="flex gap-1 text-xs bg-bg-card border border-bg-border rounded-lg p-1">
          {RANGOS.map((r) => (
            <button key={r.key} onClick={() => setRango(r.key)}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                rango === r.key ? 'bg-accent/20 text-accent font-medium' : 'text-muted hover:text-gray-200'
              }`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-1 p-1 rounded-xl bg-bg-card border border-bg-border w-fit">
        {[
          { key: 'custodio', label: 'Por custodio', icon: Building2 },
          { key: 'activo',   label: 'Por activo',   icon: Package },
        ].map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm transition-colors ${
              tab === key ? 'bg-accent/15 text-accent font-medium' : 'text-muted hover:text-gray-200'
            }`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {error && <ErrorBox message={error} />}
      {loading && <Spinner />}

      {!loading && !error && data && (
        <>
          <Tabla data={data} agrupacion={tab} />
          {disp?.desde && (
            <p className="text-xs text-muted">
              El historial por activo y custodio arranca el {formatDate(disp.desde)} — es cuando se empezó a
              guardar el detalle diario. El patrimonio total sí tiene toda su historia en Rentabilidad.
            </p>
          )}
        </>
      )}
    </div>
  );
}
