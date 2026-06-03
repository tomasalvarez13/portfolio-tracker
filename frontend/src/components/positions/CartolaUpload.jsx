import { useState, useRef } from 'react';
import { parseCartola, createPosition } from '../../services/api';
import { formatCLP, formatUSD, formatUnits } from '../../utils/formatters';
import { Upload, FileText, Sparkles } from 'lucide-react';

export default function CartolaUpload({ instruments, onDone, onCancel }) {
  const [file, setFile]         = useState(null);
  const [parsing, setParsing]   = useState(false);
  const [rows, setRows]         = useState(null); // null = aún no procesado
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState(null);
  const inputRef                = useRef(null);

  // ── Drag & drop ──────────────────────────────────────────────────────────────
  function handleDrop(e) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) { setFile(f); setError(null); }
  }

  // ── Paso 1: enviar a la IA ────────────────────────────────────────────────────
  async function handleParse() {
    if (!file) return;
    setParsing(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { proposals } = await parseCartola(fd);
      // Filtrar filas con valor cero o vacío (no tiene sentido agregar $0)
      const valid = proposals.filter(p => {
        const units = Number(p.units ?? 0);
        const clp   = Number(p.amount_clp ?? 0);
        const usd   = Number(p.amount_usd ?? 0);
        return units > 0 || clp > 0 || usd > 0;
      });
      // Construir filas editables
      setRows(valid.map((p, i) => ({
        ...p,
        _id:         i,
        _status:     'approved',  // 'approved' | 'rejected'
        _editing:    false,
        instrument_id: p.instrument_id ? String(p.instrument_id) : '',
      })));
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setParsing(false);
    }
  }

  // ── Paso 2: confirmar posiciones aprobadas ────────────────────────────────────
  async function handleConfirm() {
    const toCreate = rows.filter(r => r._status === 'approved' && r.instrument_id);
    if (!toCreate.length) return;
    setSaving(true); setError(null);
    try {
      for (const r of toCreate) {
        await createPosition({
          instrument_id: Number(r.instrument_id),
          units:      r.units      ?? null,
          amount_clp: r.amount_clp ?? null,
          amount_usd: r.amount_usd ?? null,
          notes:      r.notes      ?? null,
        });
      }
      onDone?.();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  }

  function updateRow(id, updates) {
    setRows(rs => rs.map(r => r._id === id ? { ...r, ...updates } : r));
  }

  // ── Pantalla 1: upload ────────────────────────────────────────────────────────
  if (rows === null) {
    return (
      <div className="card p-5 space-y-4">
        <div>
          <h3 className="font-medium">Subir cartola</h3>
          <p className="text-xs text-muted mt-0.5">La IA extrae las posiciones del documento y te muestra una propuesta para revisar. Soporta PDF, JPG y PNG.</p>
        </div>

        <div
          onClick={() => inputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          className="border-2 border-dashed border-bg-border rounded-xl p-8 text-center cursor-pointer hover:border-accent/50 hover:bg-accent/5 transition-colors select-none">
          <input ref={inputRef} type="file" accept=".pdf,image/*" className="hidden"
            onChange={e => { setFile(e.target.files[0]); setError(null); }} />
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
          <button onClick={handleParse} disabled={!file || parsing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-accent hover:bg-accent/90 text-white disabled:opacity-50">
            <Sparkles size={14} />
            {parsing ? 'Analizando…' : 'Analizar con IA'}
          </button>
        </div>
      </div>
    );
  }

  // ── Pantalla 2: revisión ──────────────────────────────────────────────────────
  const approved = rows.filter(r => r._status === 'approved' && r.instrument_id).length;
  const withoutInstrument = rows.filter(r => r._status === 'approved' && !r.instrument_id).length;

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h3 className="font-medium">Propuesta de la IA</h3>
        <p className="text-xs text-muted mt-0.5">Revisá cada posición antes de confirmar. Podés editar o rechazar las que no correspondan.</p>
      </div>

      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
        {rows.length === 0 && (
          <p className="text-sm text-muted text-center py-6">No se encontraron posiciones en el documento.</p>
        )}
        {rows.map(row => {
          const inst = instruments.find(i => i.id === Number(row.instrument_id));
          return (
            <div key={row._id} className={`rounded-lg border p-3 transition-opacity ${
              row._status === 'rejected' ? 'opacity-40' : 'border-bg-border'
            }`}>
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0 space-y-2">
                  <p className="text-sm font-medium truncate">{row.instrument_name}</p>

                  {row._editing ? (
                    // Modo edición inline
                    <div className="grid grid-cols-2 gap-2">
                      <div className="col-span-2">
                        <label className="text-xs text-muted">Instrumento del sistema</label>
                        <select value={row.instrument_id}
                          onChange={e => updateRow(row._id, { instrument_id: e.target.value })}
                          className="mt-0.5 w-full bg-bg-base border border-bg-border rounded px-2 py-1.5 text-xs">
                          <option value="">Sin asignar…</option>
                          {instruments.map(i => (
                            <option key={i.id} value={i.id}>{i.alias || i.name}{i.ticker ? ` (${i.ticker})` : ''}</option>
                          ))}
                        </select>
                      </div>
                      {row.units != null && (
                        <div>
                          <label className="text-xs text-muted">Cuotas / unidades</label>
                          <input type="number" step="any" value={row.units}
                            onChange={e => updateRow(row._id, { units: Number(e.target.value), amount_clp: null, amount_usd: null })}
                            className="mt-0.5 w-full bg-bg-base border border-bg-border rounded px-2 py-1.5 text-xs num" />
                        </div>
                      )}
                      {row.amount_clp != null && (
                        <div>
                          <label className="text-xs text-muted">Monto CLP</label>
                          <input type="number" step="any" value={row.amount_clp}
                            onChange={e => updateRow(row._id, { amount_clp: Number(e.target.value), units: null, amount_usd: null })}
                            className="mt-0.5 w-full bg-bg-base border border-bg-border rounded px-2 py-1.5 text-xs num" />
                        </div>
                      )}
                      {row.amount_usd != null && (
                        <div>
                          <label className="text-xs text-muted">Monto USD</label>
                          <input type="number" step="any" value={row.amount_usd}
                            onChange={e => updateRow(row._id, { amount_usd: Number(e.target.value), units: null, amount_clp: null })}
                            className="mt-0.5 w-full bg-bg-base border border-bg-border rounded px-2 py-1.5 text-xs num" />
                        </div>
                      )}
                    </div>
                  ) : (
                    // Vista normal
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                      {inst
                        ? <span className="text-accent">→ {inst.alias || inst.name}</span>
                        : <span className="text-loss">⚠ Sin instrumento — editá para asignar</span>}
                      {row.units      != null && <span>{formatUnits(row.units)} cuotas</span>}
                      {row.amount_clp != null && <span>{formatCLP(row.amount_clp)}</span>}
                      {row.amount_usd != null && <span>{formatUSD(row.amount_usd)}</span>}
                      {row.notes && <span className="italic">{row.notes}</span>}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => updateRow(row._id, { _editing: !row._editing })}
                    className="text-xs text-muted hover:text-gray-200 px-2 py-1 rounded hover:bg-bg-hover">
                    {row._editing ? 'OK' : 'editar'}
                  </button>
                  <button
                    onClick={() => updateRow(row._id, { _status: row._status === 'rejected' ? 'approved' : 'rejected' })}
                    className={`text-xs px-2 py-1 rounded ${
                      row._status === 'rejected' ? 'text-gain hover:text-gain/70' : 'text-muted hover:text-loss'
                    }`}>
                    {row._status === 'rejected' ? 'restaurar' : 'rechazar'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {withoutInstrument > 0 && (
        <p className="text-xs text-loss">
          {withoutInstrument} posición{withoutInstrument > 1 ? 'es' : ''} sin instrumento asignado — editá para asignar o rechazalas.
        </p>
      )}
      {error && <p className="text-xs text-loss">{error}</p>}

      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-4 py-2 rounded-lg text-sm text-muted hover:bg-bg-hover">Cancelar</button>
        <button onClick={handleConfirm} disabled={approved === 0 || saving}
          className="px-4 py-2 rounded-lg text-sm bg-accent hover:bg-accent/90 text-white disabled:opacity-50">
          {saving ? 'Guardando…' : `Confirmar ${approved} posición${approved !== 1 ? 'es' : ''}`}
        </button>
      </div>
    </div>
  );
}
