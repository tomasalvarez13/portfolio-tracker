import { TYPE_LABELS } from '../../utils/formatters';

const TYPE_STYLES = {
  stock_us: 'bg-blue-500/15 text-blue-300',
  stock_cl: 'bg-indigo-500/15 text-indigo-300',
  crypto: 'bg-amber-500/15 text-amber-300',
  fondo_mutuo_cl: 'bg-emerald-500/15 text-emerald-300',
  afp: 'bg-purple-500/15 text-purple-300',
};

export function TypeBadge({ type }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${TYPE_STYLES[type] || 'bg-gray-500/15 text-gray-300'}`}>
      {TYPE_LABELS[type] || type}
    </span>
  );
}

export function StaleBadge() {
  return (
    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-500/15 text-yellow-300" title="Precio no actualizado hoy; se muestra el último disponible">
      desfasado
    </span>
  );
}
