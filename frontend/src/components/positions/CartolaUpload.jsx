import { useState, useRef, useEffect } from 'react';
import { uploadStatement, confirmStatement, updateStatement, createCustodian } from '../../services/api';
import { formatCLP, formatUSD, formatUnits } from '../../utils/formatters';
import { Upload, FileText, Sparkles, Plus } from 'lucide-react';

// Sube una cartola, muestra lo que la IA extrajo con los candidatos que el
// backend encontró en el maestro, y confirma todo en un solo request.
//
// Tres diferencias con la versión anterior:
//
//  - El custodio es obligatorio. Antes no se preguntaba y todo caía en "Sin
//    custodio", lo que con la clave única nueva podía DUPLICAR una posición que
//    ya existía en un custodio real.
//  - Los activos que no están en el maestro se pueden crear desde acá. Antes la
//    fila quedaba muerta y se descartaba al confirmar.
//  - El confirm es un request, no N. Antes cada fila era un POST que recalculaba
//    el snapshot completo del portafolio.
export default function CartolaUpload({ custodians = [], onDone, onCancel }) {
  const [file, setFile]       = useState(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState(null);
  const inputRef              = useRef(null);

  // Resultado del upload
  const [statement, setStatement] = useState(null); // null = todavía no se subió
  const [rows, setRows]           = useState([]);
  const [custodianId, setCustodianId] = useState('');
  const [statementDate, setStatementDate] = useState('');
  const [detected, setDetected]   = useState(null);

  // Alta de custodio inline
  const [newCustodian, setNewCustodian] = useState(null);
  const [localCustodians, setLocalCustodians] = useState(custodians);
  useEffect(() => { setLocalCustodians(custodians); }, [custodians]);

  function handleDrop(e) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) { setFile(f); setError(null); }
  }

  async function saveCustodian() {
    const name = (newCustodian || '').trim();
    if (name.length < 2) return;
    try {
      const c = await createCustodian({ name });
      setLocalCustodians((cs) => cs.some((x) => x.id === c.id) ? cs : [...cs, c]);
      setCustodianId(String(c.id));
      setNewCustodian(null);
    } catch (e) { setError(e.response?.data?.error || e.message); }
  }

  // ── Paso 1: subir y parsear ─────────────────────────────────────────────────
  async function handleUpload() {
    if (!file) return;
    setParsing(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (custodianId) fd.append('custodian_id', custodianId);

      const data = await uploadStatement(fd);
      setStatement(data.statement);
      setDetected(data.custodian_name_detectado);
      if (data.statement.custodian_id != null) setCustodianId(String(data.statement.custodian_id));
      setStatementDate(data.statement.statement_date?.slice(0, 10) || '');

      setRows(data.rows.map((r, i) => ({
        ...r,
        _id: i,
        _status: 'approved',
        // El mejor candidato viene preseleccionado, pero solo si es razonable:
        // por debajo de 0.4 es más honesto dejarlo sin asignar que sugerir algo
        // que el usuario podría aceptar sin mirar.
        instrument_id: r.candidates?.[0]?.similarity >= 0.4 ? String(r.candidates[0].id) : '',
        _create: false,
      })));
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setParsing(false);
    }
  }

  // ── Paso 2: confirmar ───────────────────────────────────────────────────────
  async function handleConfirm() {
    const toSend = rows
      .filter((r) => r._status === 'approved' && (r.instrument_id || r._create))
      .map((r) => ({
        instrument_id:   r.instrument_id ? Number(r.instrument_id) : null,
        create_instrument: !r.instrument_id && r._create,
        instrument_name: r.instrument_name,
        units:      r.units,
        amount_clp: r.amount_clp,
        amount_usd: r.amount_usd,
        notes:      r.notes,
      }));
    if (!toSend.length) return;

    setSaving(true); setError(null);
    try {
      if (custodianId && Number(custodianId) !== statement.custodian_id) {
        await updateStatement(statement.id, { custodian_id: Number(custodianId) });
      }
      await confirmStatement(statement.id, { rows: toSend, date: statementDate || undefined });
      onDone?.();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  }

  const updateRow = (id, patch) => setRows((rs) => rs.map((r) => r._id === id ? { ...r, ...patch } : r));

  const custodianPicker = (
    <div>
      <div className="flex items-center justify-between">
        <label className="text-xs text-muted">Custodio de esta cartola</label>
        {newCustodian === null && (
          <button type="button" onClick={() => setNewCustodian('')} className="text-xs text-accent hover:underline">
            + Agregar otro
          </button>
        )}
      </div>
      {newCustodian === null ? (
        <select value={custodianId} onChange={(e) => setCustodianId(e.target.value)}
          className="mt-1 w-full bg-bg-base border border-bg-border rounded-lg px-3 py-2 text-sm">
          <option value="">Selecciona…</option>
          {localCustodians.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      ) : (
        <div className="mt-1 flex gap-2">
          <input autoFocus value={newCustodian} placeholder="Nombre del custodio"
            onChange={(e) => setNewCustodian(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveCustodian(); } }}
            className="flex-1 bg-bg-base border border-bg-border rounded-lg px-3 py-2 text-sm" />
          <button type="button" onClick={saveCustodian}
            className="px-3 py-2 rounded-lg text-sm bg-accent hover:bg-accent/90 text-white">Crear</button>
          <button type="button" onClick={() => setNewCustodian(null)}
            className="px-3 py-2 rounded-lg text-sm text-muted hover:bg-bg-hover">Cancelar</button>
        </div>
      )}
      {detected && (
        <p className="text-xs text-muted mt-1">La cartola dice: “{detected}”</p>
      )}
    </div>
  );

  // ── Pantalla 1: upload ──────────────────────────────────────────────────────
  if (statement === null) {
    return (
      <div className="card p-5 space-y-4">
        <div>
          <h3 className="font-medium">Subir cartola</h3>
          <p className="text-xs text-muted mt-0.5">
            La IA extrae las posiciones y el sistema busca a qué activo del maestro corresponde cada una.
            Revisás la propuesta antes de confirmar. Soporta PDF, JPG y PNG.
          </p>
        </div>

        {custodianPicker}

        <div
          onClick={() => inputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="border-2 border-dashed border-bg-border rounded-xl p-8 text-center cursor-pointer hover:border-accent/50 hover:bg-accent/5 transition-colors select-none">
          <input ref={inputRef} type="file" accept=".pdf,image/*" className="hidden"
            onChange={(e) => { setFile(e.target.files[0]); setError(null); }} />
          {file ? (
            <div className="space-y-1">
              <FileText size={24} className="mx-auto text-accent" />
              <p className="text-sm font-medium mt-2">{file.name}</p>
              <p className="text-xs text-muted">{(file.size / 1024).toFixed(0)} KB</p>
            </div>
          ) : (
            <div className="space-y-2">
              <Upload size={24} className="mx-auto text-muted" />
              <p className="text-sm text-muted">Arrastrá o hacé click para subir</p>
              <p className="text-xs text-muted">PDF, JPG, PNG — máx. 10 MB</p>
            </div>
          )}
        </div>

        {error && <p className="text-xs text-loss">{error}</p>}

        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-4 py-2 rounded-lg text-sm text-muted hover:bg-bg-hover">Cancelar</button>
          <button onClick={handleUpload} disabled={!file || parsing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-accent hover:bg-accent/90 text-white disabled:opacity-50">
            <Sparkles size={14} />
            {parsing ? 'Analizando…' : 'Analizar con IA'}
          </button>
        </div>
      </div>
    );
  }

  // ── Pantalla 2: revisión ────────────────────────────────────────────────────
  const listas = rows.filter((r) => r._status === 'approved' && (r.instrument_id || r._create)).length;
  const sinAsignar = rows.filter((r) => r._status === 'approved' && !r.instrument_id && !r._create).length;

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h3 className="font-medium">Propuesta de la cartola</h3>
        <p className="text-xs text-muted mt-0.5">
          Los saldos se guardan con la fecha de la cartola, no la de hoy. Reemplazan la posición que tengas
          en este custodio, no se suman a ella.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {custodianPicker}
        <div>
          <label className="text-xs text-muted">Fecha de la cartola</label>
          <input type="date" value={statementDate} onChange={(e) => setStatementDate(e.target.value)}
            className="mt-1 w-full bg-bg-base border border-bg-border rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
        {rows.length === 0 && (
          <p className="text-sm text-muted text-center py-6">No se encontraron posiciones en el documento.</p>
        )}
        {rows.map((row) => {
          const rechazada = row._status === 'rejected';
          const elegido = row.candidates?.find((c) => String(c.id) === row.instrument_id);
          return (
            <div key={row._id} className={`rounded-lg border border-bg-border p-3 ${rechazada ? 'opacity-40' : ''}`}>
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0 space-y-2">
                  <p className="text-sm font-medium truncate">{row.instrument_name}</p>

                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                    {row.units      != null && <span>{formatUnits(row.units)} cuotas</span>}
                    {row.amount_clp != null && <span>{formatCLP(row.amount_clp)}</span>}
                    {row.amount_usd != null && <span>{formatUSD(row.amount_usd)}</span>}
                    {row.notes && <span className="italic">{row.notes}</span>}
                  </div>

                  {row._create ? (
                    <p className="text-xs text-accent flex items-center gap-1">
                      <Plus size={12} /> Se va a crear como activo nuevo, sin fuente de precios todavía
                    </p>
                  ) : (
                    <div className="flex items-center gap-2">
                      <select value={row.instrument_id}
                        onChange={(e) => updateRow(row._id, { instrument_id: e.target.value })}
                        className="flex-1 bg-bg-base border border-bg-border rounded px-2 py-1.5 text-xs">
                        <option value="">Sin asignar…</option>
                        {(row.candidates || []).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}{c.ticker ? ` (${c.ticker})` : ''} — {Math.round(c.similarity * 100)}%
                          </option>
                        ))}
                      </select>
                      {elegido && elegido.similarity < 0.55 && (
                        <span className="text-xs text-loss shrink-0" title="Coincidencia baja: verificá que sea el correcto">
                          match dudoso
                        </span>
                      )}
                    </div>
                  )}

                  {!row.instrument_id && (
                    <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer w-fit">
                      <input type="checkbox" checked={row._create}
                        onChange={(e) => updateRow(row._id, { _create: e.target.checked })} />
                      Crear como activo nuevo
                    </label>
                  )}
                </div>

                <button
                  onClick={() => updateRow(row._id, { _status: rechazada ? 'approved' : 'rejected' })}
                  className={`text-xs px-2 py-1 rounded shrink-0 ${rechazada ? 'text-gain hover:text-gain/70' : 'text-muted hover:text-loss'}`}>
                  {rechazada ? 'restaurar' : 'rechazar'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {sinAsignar > 0 && (
        <p className="text-xs text-loss">
          {sinAsignar} {sinAsignar > 1 ? 'posiciones sin asignar' : 'posición sin asignar'} — elegí un activo,
          marcala como nueva, o rechazala. No se van a guardar.
        </p>
      )}
      {!custodianId && <p className="text-xs text-loss">Elegí el custodio de esta cartola antes de confirmar.</p>}
      {error && <p className="text-xs text-loss">{error}</p>}

      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-4 py-2 rounded-lg text-sm text-muted hover:bg-bg-hover">Cancelar</button>
        <button onClick={handleConfirm} disabled={listas === 0 || saving || !custodianId}
          className="px-4 py-2 rounded-lg text-sm bg-accent hover:bg-accent/90 text-white disabled:opacity-50">
          {saving ? 'Guardando…' : `Confirmar ${listas} ${listas === 1 ? 'posición' : 'posiciones'}`}
        </button>
      </div>
    </div>
  );
}
