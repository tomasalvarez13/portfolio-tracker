import { useState } from 'react';
import { formatCLP, formatUSD, formatUnits } from '../../utils/formatters';

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function AporteForm({ position, onSubmit, onCancel }) {
  const mode = position.units != null ? 'units'
    : position.amount_clp != null ? 'amount_clp'
    : 'amount_usd';

  const [delta, setDelta] = useState('');
  const [movClp, setMovClp] = useState('');
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState(`Aporte a ${position.alias || position.name}`);

  function submit(e) {
    e.preventDefault();
    const num = Number(delta);
    onSubmit({
      date,
      notes: notes || null,
      delta_units: mode === 'units' ? num : null,
      delta_amount_clp: mode === 'amount_clp' ? num : null,
      delta_amount_usd: mode === 'amount_usd' ? num : null,
      movement_clp: mode === 'amount_clp' ? num : (movClp ? Number(movClp) : null),
    });
  }

  const currentLabel = mode === 'units'
    ? `${formatUnits(position.units)} unidades`
    : mode === 'amount_clp' ? formatCLP(position.amount_clp)
    : formatUSD(position.amount_usd);

  const deltaLabel = mode === 'units' ? 'Unidades/cuotas a agregar'
    : mode === 'amount_clp' ? 'Monto a agregar (CLP)'
    : 'Monto a agregar (USD)';

  return (
    <form onSubmit={submit} className="card p-5 space-y-4">
      <div>
        <h3 className="font-medium">Agregar aporte</h3>
        <p className="text-xs text-muted mt-0.5">
          {position.alias || position.name} · actual: {currentLabel}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted">Fecha</label>
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full bg-bg-base border border-bg-border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-xs text-muted">{deltaLabel}</label>
          <input type="number" step="any" required value={delta} onChange={(e) => setDelta(e.target.value)}
            className="mt-1 w-full bg-bg-base border border-bg-border rounded-lg px-3 py-2 text-sm num" />
        </div>
      </div>

      {mode !== 'amount_clp' && (
        <div>
          <label className="text-xs text-muted">Monto CLP del aporte (para historial)</label>
          <input type="number" step="any" value={movClp} onChange={(e) => setMovClp(e.target.value)}
            placeholder="Opcional — podés registrarlo después en Movimientos"
            className="mt-1 w-full bg-bg-base border border-bg-border rounded-lg px-3 py-2 text-sm num placeholder:text-muted/50" />
        </div>
      )}

      <div>
        <label className="text-xs text-muted">Notas</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)}
          className="mt-1 w-full bg-bg-base border border-bg-border rounded-lg px-3 py-2 text-sm" />
      </div>

      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel}
          className="px-4 py-2 rounded-lg text-sm text-muted hover:bg-bg-hover">Cancelar</button>
        <button type="submit"
          className="px-4 py-2 rounded-lg text-sm bg-gain/15 text-gain hover:bg-gain/25 font-medium">
          + Agregar aporte
        </button>
      </div>
    </form>
  );
}
