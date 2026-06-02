export function Card({ children, className = '' }) {
  return <div className={`card p-5 ${className}`}>{children}</div>;
}

export function StatCard({ label, value, sub, valueClass = '' }) {
  return (
    <div className="card p-4 lg:p-5">
      <div className="text-[10px] lg:text-xs text-muted uppercase tracking-wide">{label}</div>
      <div className={`mt-1.5 text-lg lg:text-2xl font-semibold num truncate ${valueClass}`}>{value}</div>
      {sub != null && <div className="mt-0.5 text-xs text-muted num">{sub}</div>}
    </div>
  );
}
