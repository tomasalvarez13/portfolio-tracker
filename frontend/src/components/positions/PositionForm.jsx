import { useState, useEffect } from 'react';

// Formulario para crear/editar una posición. Modo unidades o monto directo.
export default function PositionForm({ instruments, initial, onSubmit, onCancel }) {
  const [instrumentId, setInstrumentId] = useState(initial?.instrument_id || '');
  const [mode, setMode] = useState(
    initial?.amount_clp != null ? 'amount_clp'
      : initial?.amount_usd != null ? 'amount_usd'
      : 'units'
  );
  const [value, setValue] = useState(
    initial?.units ?? initial?.amount_clp ?? initial?.amount_usd ?? ''
  );
  const [notes, setNotes] = useState(initial?.notes || '');

  useEffect(() => {
    if (initial) {
      setInstrumentId(initial.instrument_id);
      setValue(initial.units ?? initial.amount_clp ?? initial.amount_usd ?? '');
    }
  }, [initial]);

  function submit(e) {
    e.preventDefault();
    const num = Number(value);
    const body = { instrument_id: Number(instrumentId), notes, units: null, amount_clp: null, amount_usd: null };
    body[mode] = num;
    onSubmit(body);
  }

  return (
    <form onSubmit={submit} className="card p-5 space-y-4">
      <h3 className="font-medium">{initial ? 'Editar posición' : 'Nueva posición'}</h3>

      <div>
        <label className="text-xs text-muted">Instrumento</label>
        <select required value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)}
          disabled={!!initial}
          className="mt-1 w-full bg-bg-base border border-bg-border rounded-lg px-3 py-2 text-sm disabled:opacity-60">
          <option value="">Selecciona…</option>
          {instruments.map((i) => (
            <option key={i.id} value={i.id}>{i.name} {i.ticker ? `(${i.ticker})` : ''}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-2 text-xs">
        {['units', 'amount_clp', 'amount_usd'].map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)}
            className={`px-3 py-1.5 rounded-lg ${mode === m ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-bg-hover'}`}>
            {m === 'units' ? 'Unidades/Cuotas' : m === 'amount_clp' ? 'Monto CLP' : 'Monto USD'}
          </button>
        ))}
      </div>

      <div>
        <label className="text-xs text-muted">
          {mode === 'units' ? 'Cantidad de unidades/cuotas' : mode === 'amount_clp' ? 'Monto en CLP' : 'Monto en USD'}
        </label>
        <input type="number" step="any" required value={value} onChange={(e) => setValue(e.target.value)}
          className="mt-1 w-full bg-bg-base border border-bg-border rounded-lg px-3 py-2 text-sm num" />
      </div>

      <div>
        <label className="text-xs text-muted">Notas (opcional)</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)}
          className="mt-1 w-full bg-bg-base border border-bg-border rounded-lg px-3 py-2 text-sm" />
      </div>

      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-sm text-muted hover:bg-bg-hover">Cancelar</button>
        <button type="submit" className="px-4 py-2 rounded-lg text-sm bg-accent hover:bg-accent/90 text-white">Guardar</button>
      </div>
    </form>
  );
}
