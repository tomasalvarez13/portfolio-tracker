import { useState, useEffect } from 'react';
import { createCustodian } from '../../services/api';

// Formulario para crear/editar una posición. Modo unidades o monto directo.
//
// El custodio es parte de la identidad de la posición: el mismo fondo en Fintual
// y en Banchile son dos posiciones distintas. Por eso el selector es obligatorio
// al crear, y no se puede cambiar al editar (sería mover la posición de lugar,
// no editarla).
export default function PositionForm({ instruments, custodians = [], initial, onSubmit, onCancel }) {
  const [instrumentId, setInstrumentId] = useState(initial?.instrument_id || '');
  const [custodianId, setCustodianId]   = useState(
    initial?.custodian_id != null ? String(initial.custodian_id) : ''
  );
  const [mode, setMode] = useState(
    initial?.amount_clp != null ? 'amount_clp'
      : initial?.amount_usd != null ? 'amount_usd'
      : 'units'
  );
  const [value, setValue] = useState(
    initial?.units ?? initial?.amount_clp ?? initial?.amount_usd ?? ''
  );
  const [notes, setNotes] = useState(initial?.notes || '');

  // Alta de custodio nuevo desde el mismo form
  const [newCustodian, setNewCustodian] = useState(null); // null = cerrado
  const [savingCustodian, setSavingCustodian] = useState(false);
  const [custodianError, setCustodianError] = useState(null);
  const [localCustodians, setLocalCustodians] = useState(custodians);

  useEffect(() => { setLocalCustodians(custodians); }, [custodians]);

  useEffect(() => {
    if (initial) {
      setInstrumentId(initial.instrument_id);
      if (initial.custodian_id != null) setCustodianId(String(initial.custodian_id));
      setValue(initial.units ?? initial.amount_clp ?? initial.amount_usd ?? '');
    }
  }, [initial]);

  async function saveCustodian() {
    const name = (newCustodian || '').trim();
    if (name.length < 2) { setCustodianError('Escribí un nombre'); return; }
    setSavingCustodian(true); setCustodianError(null);
    try {
      const c = await createCustodian({ name });
      setLocalCustodians((cs) => cs.some((x) => x.id === c.id) ? cs : [...cs, c]);
      setCustodianId(String(c.id));
      setNewCustodian(null);
    } catch (e) {
      setCustodianError(e.response?.data?.error || e.message);
    } finally {
      setSavingCustodian(false);
    }
  }

  function submit(e) {
    e.preventDefault();
    const num = Number(value);
    const body = {
      instrument_id: Number(instrumentId),
      custodian_id: custodianId === '' ? 0 : Number(custodianId),
      notes, units: null, amount_clp: null, amount_usd: null,
    };
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

      <div>
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted">Custodio</label>
          {!initial && newCustodian === null && (
            <button type="button" onClick={() => { setNewCustodian(''); setCustodianError(null); }}
              className="text-xs text-accent hover:underline">
              + Agregar otro
            </button>
          )}
        </div>

        {newCustodian === null ? (
          <select required value={custodianId} onChange={(e) => setCustodianId(e.target.value)}
            disabled={!!initial}
            className="mt-1 w-full bg-bg-base border border-bg-border rounded-lg px-3 py-2 text-sm disabled:opacity-60">
            <option value="">Selecciona…</option>
            {localCustodians.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        ) : (
          <div className="mt-1 space-y-2">
            <div className="flex gap-2">
              <input autoFocus value={newCustodian} placeholder="Nombre del custodio"
                onChange={(e) => setNewCustodian(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveCustodian(); } }}
                className="flex-1 bg-bg-base border border-bg-border rounded-lg px-3 py-2 text-sm" />
              <button type="button" onClick={saveCustodian} disabled={savingCustodian}
                className="px-3 py-2 rounded-lg text-sm bg-accent hover:bg-accent/90 text-white disabled:opacity-50">
                {savingCustodian ? '…' : 'Crear'}
              </button>
              <button type="button" onClick={() => { setNewCustodian(null); setCustodianError(null); }}
                className="px-3 py-2 rounded-lg text-sm text-muted hover:bg-bg-hover">
                Cancelar
              </button>
            </div>
            {custodianError && <p className="text-xs text-loss">{custodianError}</p>}
          </div>
        )}

        {initial && (
          <p className="text-xs text-muted mt-1">
            Para mover la posición a otro custodio, creá una nueva y cerrá esta.
          </p>
        )}
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
        <p className="text-xs text-muted mt-1">
          Es el saldo actual, no un aporte: si ya tenías una posición acá, este valor la reemplaza.
        </p>
      </div>

      <div>
        <label className="text-xs text-muted">Notas (opcional)</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)}
          className="mt-1 w-full bg-bg-base border border-bg-border rounded-lg px-3 py-2 text-sm" />
      </div>

      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-sm text-muted hover:bg-bg-hover">Cancelar</button>
        <button type="submit" disabled={newCustodian !== null}
          className="px-4 py-2 rounded-lg text-sm bg-accent hover:bg-accent/90 text-white disabled:opacity-50">
          Guardar
        </button>
      </div>
    </form>
  );
}
