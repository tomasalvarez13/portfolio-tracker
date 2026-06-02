import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import { formatCLP, formatPct, TYPE_LABELS } from '../../utils/formatters';

const COLORS = {
  stock_us: '#3b82f6',
  stock_cl: '#6366f1',
  crypto: '#f59e0b',
  fondo_mutuo_cl: '#10b981',
  afp: '#a855f7',
};

export default function BreakdownChart({ breakdown }) {
  const data = breakdown.map((b) => ({
    name: TYPE_LABELS[b.type] || b.type,
    type: b.type,
    value: b.total_clp,
    pct: b.pct,
  }));

  return (
    <div className="card p-5">
      <h3 className="font-medium mb-4">Distribución por tipo</h3>
      {data.length === 0 ? (
        <div className="text-muted text-sm py-16 text-center">Sin datos</div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%"
              innerRadius={70} outerRadius={110} paddingAngle={2}>
              {data.map((d) => <Cell key={d.type} fill={COLORS[d.type] || '#6b7280'} stroke="#0d1117" />)}
            </Pie>
            <Tooltip
              contentStyle={{ background: '#161b22', border: '1px solid #262d36', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: '#e6edf3' }}
              itemStyle={{ color: '#e6edf3' }}
              formatter={(v, _n, item) => [`${formatCLP(v)} · ${formatPct(item.payload.pct, { sign: false })}`, item.payload.name]} />
            <Legend formatter={(v) => <span style={{ color: '#8b949e', fontSize: 12 }}>{v}</span>} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
