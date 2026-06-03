import { useState } from 'react';
import { formatCLP, formatUSD, formatUnits } from '../../utils/formatters';

const todayISO = () => new Date().toISOString().slice(0, 10);

// Si se pasa `preSelected`, el instrumento está fijo.
// Si se pasa `positions` (lista), el usuario elige desde un dropdown.
// `type` puede ser 'aporte' (default) o 'retiro'.
export default function AporteForm({ positions, preSelected, onSubmit, onCancel, type = 'aporte' }) {
  const [selectedId, setSelectedId] = useState(preSelected?.id ?? '');
  const [delta, setDelta]           = useState('');
  const [movClp, setMovClp]         = useState('');
  const [date, setDate]             = useState(todayISO());
  const [notes, setNotes]           = useState('');

  const position = preSelected ?? positions?.find((p) => p.id === Number(selectedId));

  const mode = position
    ? (position.units != null ? 'units' : position.amount_clp != null ? 'amount_clp' : 'amount_usd')
    : null;

  // Auto-fill notes cuando se selecciona un instrumento
  function handleSelectId(id) {
    setSelectedId(id);
    const pos = positions?.find((p) => p.id === Number(id));
    if (pos) setNotes(`Aporte a ${pos.alias || pos.name}`);
  }

  function submit(e) {
    e.preventDefault();
    const num = Number(delta);
    onSubmit(position.id, {
      type,
      date,
      notes: notes || null,
      delta_units:      mode === 'units'      ? num : null,
      delta_amount_clp: mode === 'amount_clp' ? num : null,
      delta_amount_usd: mode === 'amount_usd' ? num : null,
      movement_clp: mode === 'amount_clp' ? num : (movClp ? Number(movClp) : null),
    });
  }

  const currentLabel = position
    ? (mode === 'units'      ? `${formatUnits(position.units)} unidades`
      : mode === 'amount_clp' ? formatCLP(position.amount_clp)
      : formatUSD(position.amount_usd))
    : null;

  const deltaLabel = mode === 'units'      ? 'Unidades/cuotas a agregar'
    : mode === 'amount_clp' ? 'Monto a agregar (CLP)'
    : mode === 'amount_usd' ? 'Monto a agregar (USD)'
    : '';

  const isRetiro = type === 'retiro';

  return (
    <form onSubmit={submit} className="card p-5 space-y-4">
      <h3 className="font-medium">{isRetiro ? 'Retiro de posición existente' : 'Aporte a posición existente'}</h3>

      {/* Selector de instrumento (solo cuando no viene pre-seleccionado) */}
      {!preSelected && (
        <div>
          <label className="text-xs text-muted">Instrumento</label>
          <select required value={selectedId} onChange={(e) => handleSelectId(e.target.value)}
            className="mt-1 w-full bg-bg-base border border-bg-border rounded-lg px-3 py-2 text-sm">
            <option value="">Seleccioná una posición…</option>
            {(positions ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.alias || p.name}{p.ticker ? ` (${p.ticker})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Info de la posición seleccionada */}
      {position && !preSelected && (
        <p className="text-xs text-muted -mt-2">Valor actual: {currentLabel}</p>
      )}
      {preSelected && (
        <p className="text-xs text-muted -mt-2">
          {preSelected.alias || preSelected.name} · actual: {currentLabel}
        </p>
      )}

      {/* Campos de monto y fecha (solo cuando hay una posición seleccionada) */}
      {position && (
        <>
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
              <label className="text-xs text-muted">Monto CLP del {isRetiro ? 'retiro' : 'aporte'} (para historial)</label>
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
        </>
      )}

      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel}
          className="px-4 py-2 rounded-lg text-sm text-muted hover:bg-bg-hover">Cancelar</button>
        {position && (
          <button type="submit"
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              isRetiro
                ? 'bg-loss/15 text-loss hover:bg-loss/25'
                : 'bg-gain/15 text-gain hover:bg-gain/25'
            }`}>
            {isRetiro ? '− Registrar retiro' : '+ Agregar aporte'}
          </button>
        )}
      </div>
    </form>
  );
}
