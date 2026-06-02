import { useEffect, useState } from 'react';
import { getMarket } from '../services/api';
import { formatCLP, formatUSD, formatPct, formatDate, colorForValue } from '../utils/formatters';
import { TypeBadge, StaleBadge } from '../components/ui/Badge.jsx';
import { StatCard } from '../components/ui/Card.jsx';
import { Spinner, ErrorBox } from '../components/ui/Spinner.jsx';

export default function Mercado() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try { setData(await getMarket()); }
      catch (e) { setError(e.response?.data?.error || e.message); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;

  const btc = data?.instruments?.find((i) => i.type === 'crypto');
  const stocks = data?.instruments?.filter((i) => i.type !== 'crypto') || [];

  return (
    <div className="space-y-4 lg:space-y-6">
      <h2 className="text-lg lg:text-xl font-semibold">Mercado</h2>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">
        <StatCard label="Dólar observado"
          value={data?.dolar ? formatCLP(data.dolar.usd_clp) : '—'}
          sub={data?.dolar?.date ? `al ${formatDate(data.dolar.date)}` : null}
          valueClass="" />
        <StatCard label="Bitcoin (USD)"
          value={btc?.price_usd != null ? formatUSD(btc.price_usd) : '—'}
          sub={btc?.change_pct != null ? formatPct(btc.change_pct) : null}
          valueClass={colorForValue(btc?.change_pct)} />
        <StatCard label="Bitcoin (CLP)"
          value={btc?.price_clp != null ? formatCLP(btc.price_clp) : '—'} />
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-bg-border font-medium text-sm">Mis acciones / ETFs</div>
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[480px]">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-bg-border">
              <th className="px-4 py-3 font-medium">Instrumento</th>
              <th className="px-4 py-3 font-medium">Tipo</th>
              <th className="px-4 py-3 font-medium text-right">Precio</th>
              <th className="px-4 py-3 font-medium text-right">Variación</th>
              <th className="px-4 py-3 font-medium text-right">Fecha</th>
            </tr>
          </thead>
          <tbody>
            {stocks.map((s) => (
              <tr key={s.id} className="border-b border-bg-border/50 hover:bg-bg-hover/40">
                <td className="px-4 py-3">
                  <div className="font-medium">{s.name}</div>
                  {s.ticker && <div className="text-xs text-muted">{s.ticker}</div>}
                </td>
                <td className="px-4 py-3"><TypeBadge type={s.type} /></td>
                <td className="px-4 py-3 text-right num">
                  {s.currency === 'USD' && s.price_usd != null ? formatUSD(s.price_usd)
                    : s.price_clp != null ? formatCLP(s.price_clp) : '—'}
                </td>
                <td className={`px-4 py-3 text-right num ${colorForValue(s.change_pct)}`}>
                  {s.change_pct != null ? formatPct(s.change_pct) : '—'}
                </td>
                <td className="px-4 py-3 text-right text-xs text-muted">
                  <div className="flex items-center justify-end gap-1.5">
                    {s.is_stale && <StaleBadge />}
                    {formatDate(s.date)}
                  </div>
                </td>
              </tr>
            ))}
            {stocks.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">Sin acciones con precio aún. Corre “Actualizar precios” en Posiciones.</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
