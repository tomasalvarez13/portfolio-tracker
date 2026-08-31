import { useEffect, useState, useCallback } from 'react';
import { adminGetCronRuns, adminGetCronRun, adminRetryJob } from '../../services/api';
import { Timer, RefreshCw } from 'lucide-react';

// Ejecuciones del cron de precios.
//
// `price_fetch_jobs` guarda estado por (instrumento, fecha), pero los jobs se
// reabren, se reintentan y se sobreescriben: con esa tabla sola no se puede
// responder "qué pasó en la corrida de las 8:30". De ahí `job_runs`, una fila
// por ejecución, que es lo que muestra este panel.

const estadoChip = {
  done:    'bg-gain/15 text-gain',
  no_data: 'bg-bg-hover text-muted',
  failed:  'bg-loss/15 text-loss',
  pending: 'bg-accent/15 text-accent',
  running: 'bg-accent/15 text-accent',
};

const hora = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit',
    month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export default function CronPanel() {
  const [runs, setRuns]     = useState([]);
  const [cola, setCola]     = useState(null);
  const [abierta, setAbierta] = useState(null);   // id de la corrida expandida
  const [detalle, setDetalle] = useState(null);
  const [error, setError]   = useState(null);
  const [busy, setBusy]     = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await adminGetCronRuns({ limit: 30 });
      setRuns(d.runs); setCola(d.cola);
    } catch (e) { setError(e.response?.data?.error || e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function abrir(id) {
    if (abierta === id) { setAbierta(null); setDetalle(null); return; }
    setAbierta(id); setDetalle(null);
    try { setDetalle(await adminGetCronRun(id)); }
    catch (e) { setError(e.response?.data?.error || e.message); }
  }

  async function reintentar(jobId) {
    setBusy(true); setError(null);
    try { await adminRetryJob(jobId); if (abierta) setDetalle(await adminGetCronRun(abierta)); await load(); }
    catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  }

  const porEstado = cola?.por_estado || {};
  const agotados  = cola?.agotados || [];

  return (
    <div className="space-y-4">
      {/* Cola de hoy */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Timer size={16} className="text-accent" />
          <h3 className="font-medium">Cola de hoy</h3>
          <span className="text-xs text-muted">{cola?.date}</span>
          <div className="flex-1" />
          <button onClick={load} className="text-xs text-muted hover:text-gray-200 flex items-center gap-1">
            <RefreshCw size={12} /> refrescar
          </button>
        </div>

        {Object.keys(porEstado).length === 0 ? (
          <p className="text-sm text-muted">Sin jobs para hoy todavía.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {['done', 'no_data', 'pending', 'running', 'failed'].filter((k) => porEstado[k]).map((k) => (
              <span key={k} className={`text-xs px-2 py-1 rounded ${estadoChip[k] || ''}`}>
                {k}: {porEstado[k]}
              </span>
            ))}
          </div>
        )}

        {agotados.length > 0 && (
          <div className="mt-4 border-t border-bg-border pt-3">
            <p className="text-xs font-medium text-loss mb-2">
              {agotados.length} instrumento(s) agotaron sus reintentos
            </p>
            <div className="space-y-1">
              {agotados.map((a, i) => (
                <div key={i} className="text-xs text-muted">
                  <span className="text-gray-200">{a.name}</span> @{String(a.date).slice(0, 10)}
                  {a.last_error && <span className="italic"> — {a.last_error}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-loss">{error}</p>}

      {/* Historial de corridas */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-bg-border">
          <h3 className="font-medium">Ejecuciones</h3>
        </div>

        {runs.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">Todavía no corrió el cron.</p>
        ) : (
          <div className="divide-y divide-bg-border/60">
            {runs.map((r) => (
              <div key={r.id}>
                <button onClick={() => abrir(r.id)}
                  className="w-full px-5 py-3 flex items-center gap-3 text-left hover:bg-bg-hover/40 flex-wrap">
                  <span className={`text-muted transition-transform ${abierta === r.id ? 'rotate-90' : ''}`}>▸</span>
                  <span className="text-sm font-medium">{r.kind}</span>
                  <span className="text-xs text-muted">{r.trigger}</span>
                  <span className="text-xs text-muted">{hora(r.started_at)}</span>
                  {r.finished_at ? (
                    <span className="text-xs text-muted">{r.duracion_s}s</span>
                  ) : (
                    <span className="text-xs text-accent">en curso…</span>
                  )}
                  <div className="flex-1" />
                  {r.error && <span className="text-xs text-loss truncate max-w-[240px]">{r.error}</span>}
                  {r.enqueued != null && <span className="text-xs text-muted">{r.enqueued} encolados</span>}
                  {r.ok      != null && r.ok      > 0 && <span className="text-xs text-gain">{r.ok} ok</span>}
                  {r.no_data != null && r.no_data > 0 && <span className="text-xs text-muted">{r.no_data} sin dato</span>}
                  {r.failed  != null && r.failed  > 0 && <span className="text-xs text-loss">{r.failed} fallidos</span>}
                  {r.pending_after != null && (
                    <span className="text-xs text-muted">{r.pending_after} pendientes</span>
                  )}
                </button>

                {abierta === r.id && (
                  <div className="px-5 pb-4">
                    {!detalle ? (
                      <p className="text-xs text-muted">Cargando…</p>
                    ) : detalle.jobs.length === 0 ? (
                      <p className="text-xs text-muted">
                        Esta corrida no tomó jobs
                        {r.kind === 'enqueue' ? ' (solo encoló)' : ''}.
                      </p>
                    ) : (
                      <div className="space-y-1">
                        {detalle.jobs.map((j) => (
                          <div key={j.id} className="flex items-center gap-2 text-xs py-1 flex-wrap">
                            <span className={`px-1.5 py-0.5 rounded ${estadoChip[j.status] || ''}`}>{j.status}</span>
                            <span className="text-gray-200">{j.instrumento}</span>
                            <span className="text-muted">@{String(j.date).slice(0, 10)}</span>
                            <span className="text-muted">{j.source_used || j.api_source}</span>
                            {j.attempts > 1 && <span className="text-muted">{j.attempts} intentos</span>}
                            {j.last_error && <span className="text-loss italic truncate max-w-[280px]">{j.last_error}</span>}
                            <div className="flex-1" />
                            {(j.status === 'failed' || j.status === 'no_data') && (
                              <button disabled={busy} onClick={() => reintentar(j.id)}
                                className="text-accent hover:underline disabled:opacity-50">reintentar</button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
