import { useState } from 'react';

// Actualización manual del valor cuota para instrumentos sin API (FIP Venturance).
export default function ManualPriceForm({ position, onSubmit, onCancel }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [priceClp, setPriceClp] = useState(position?.price_clp ?? '');

  function submit(e) {
    e.preventDefault();
    onSubmit({ instrument_id: position.instrument_id, date, price_clp: Number(priceClp) });
  }

  return (
    <form onSubmit={submit} className="card p-5 space-y-4">
      <h3 className="font-medium">Actualizar valor cuota — {position.name}</h3>
      <p className="text-xs text-muted">
        Este fondo no tiene API pública (FIP). Ingresa el valor cuota desde tu cartola de Venturance.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted">Fecha</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full bg-bg-base border border-bg-border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-xs text-muted">Valor cuota (CLP)</label>
          <input type="number" step="any" required value={priceClp} onChange={(e) => setPriceClp(e.target.value)}
            className="mt-1 w-full bg-bg-base border border-bg-border rounded-lg px-3 py-2 text-sm num" />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-sm text-muted hover:bg-bg-hover">Cancelar</button>
        <button type="submit" className="px-4 py-2 rounded-lg text-sm bg-accent hover:bg-accent/90 text-white">Guardar precio</button>
      </div>
    </form>
  );
}
