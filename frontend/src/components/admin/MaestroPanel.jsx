import { useEffect, useState, useCallback } from 'react';
import {
  adminGetInstruments, adminUpdateInstrument, adminGetCustodians,
  adminUpdateCustodian, adminMergeCustodian, mergeInstrument, searchInstruments,
  createCustodian,
} from '../../services/api';
import { formatCLP, formatUSD, formatDate } from '../../utils/formatters';
import { Package, Building2, Search, Plus } from 'lucide-react';

const TYPES    = ['stock_us', 'stock_cl', 'crypto', 'fondo_mutuo_cl', 'afp'];
const SOURCES  = ['yahoo_finance', 'coingecko', 'cmf', 'sp', 'manual', 'alpha_vantage'];
const STATUSES = ['active', 'pending_mapping', 'deprecated'];
const LIMIT    = 50;

const chip = {
  active:          'bg-gain/15 text-gain',
  pending_mapping: 'bg-accent/15 text-accent',
  deprecated:      'bg-bg-hover text-muted',
};

const inputCls = 'bg-bg-base border border-bg-border rounded px-2 py-1.5 text-xs';

// ─── Instrumentos ─────────────────────────────────────────────────────────────
// La cola de pending_mapping que antes era una sección aparte pasa a ser un
// filtro de esta tabla: es la misma entidad mirada con otro criterio.
export function InstrumentsPanel() {
  const [data, setData]       = useState({ instruments: [], total: 0 });
  const [q, setQ]             = useState('');
  const [status, setStatus]   = useState('');
  const [type, setType]       = useState('');
  const [offset, setOffset]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm]       = useState({});
  const [mergeQ, setMergeQ]   = useState('');
  const [mergeHits, setHits]  = useState([]);
  const [busy, setBusy]       = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setData(await adminGetInstruments({
        q: q || undefined, status: status || undefined, type: type || undefined,
        limit: LIMIT, offset,
      }));
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setLoading(false); }
  }, [q, status, type, offset]);

  // Debounce: cada tecla de la búsqueda no puede disparar una query.
  useEffect(() => { const t = setTimeout(load, q ? 350 : 0); return () => clearTimeout(t); }, [load, q]);

  function abrir(it) {
    const open = editing !== it.id;
    setEditing(open ? it.id : null);
    setMergeQ(''); setHits([]); setError(null);
    setForm(open ? {
      name: it.name, alias: it.alias || '', type: it.type, ticker: it.ticker || '',
      currency: it.currency, api_source: it.api_source, external_id: it.external_id || '',
      status: it.status, fetch_enabled: it.fetch_enabled,
    } : {});
  }

  async function correr(fn) {
    setBusy(true); setError(null);
    try { await fn(); setEditing(null); await load(); }
    catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-bg-border flex items-center gap-3 flex-wrap">
        <Package size={16} className="text-accent" />
        <h3 className="font-medium">Instrumentos</h3>
        <span className="text-xs text-muted">{data.total} en el maestro</span>
        <div className="flex-1" />
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }}
            placeholder="buscar…" className={`${inputCls} pl-7 w-44`} />
        </div>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }} className={inputCls}>
          <option value="">todos los estados</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={type} onChange={(e) => { setType(e.target.value); setOffset(0); }} className={inputCls}>
          <option value="">todos los tipos</option>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {error && <p className="px-5 py-2 text-xs text-loss">{error}</p>}
      {loading && <p className="px-5 py-8 text-center text-sm text-muted">Cargando…</p>}
      {!loading && data.instruments.length === 0 && (
        <p className="px-5 py-8 text-center text-sm text-muted">Sin resultados.</p>
      )}

      <div className="divide-y divide-bg-border/60">
        {data.instruments.map((it) => (
          <div key={it.id} className="px-5 py-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{it.name}</span>
                  {it.ticker && <span className="text-xs text-muted">{it.ticker}</span>}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${chip[it.status] || ''}`}>{it.status}</span>
                  {!it.fetch_enabled && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-muted">sin fetch</span>
                  )}
                  {it.canonical_name && (
                    <span className="text-[10px] text-muted">→ fusionado en {it.canonical_name}</span>
                  )}
                </div>
                <div className="text-xs text-muted mt-0.5 flex flex-wrap gap-x-3">
                  <span>{it.type} · {it.currency} · {it.api_source}{it.external_id ? ` (${it.external_id})` : ''}</span>
                  <span>{it.holders} usuario(s), {it.tx_count} tx</span>
                  {it.price_date ? (
                    <span className={it.is_stale ? 'text-loss' : ''}>
                      {it.currency === 'USD' && it.price_usd != null ? formatUSD(it.price_usd) : formatCLP(it.price_clp)}
                      {' · '}{formatDate(it.price_date)}{it.is_stale ? ' (stale)' : ''}
                    </span>
                  ) : <span className="text-loss">sin precio</span>}
                </div>
              </div>
              <button onClick={() => abrir(it)} className="text-xs text-accent hover:underline shrink-0">
                {editing === it.id ? 'cerrar' : 'editar'}
              </button>
            </div>

            {editing === it.id && (
              <div className="mt-3 space-y-4 bg-bg-base/40 rounded-lg p-3">
                <div className="grid sm:grid-cols-3 gap-2">
                  <input placeholder="nombre" value={form.name || ''} className={`${inputCls} sm:col-span-2`}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                  <input placeholder="alias" value={form.alias || ''} className={inputCls}
                    onChange={(e) => setForm((f) => ({ ...f, alias: e.target.value }))} />
                  <select value={form.type || ''} className={inputCls}
                    onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                    {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <select value={form.api_source || ''} className={inputCls}
                    onChange={(e) => setForm((f) => ({ ...f, api_source: e.target.value }))}>
                    {SOURCES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <select value={form.currency || ''} className={inputCls}
                    onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}>
                    {['CLP', 'USD'].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input placeholder="ticker" value={form.ticker || ''} className={inputCls}
                    onChange={(e) => setForm((f) => ({ ...f, ticker: e.target.value }))} />
                  <input placeholder="external_id" value={form.external_id || ''} className={inputCls}
                    onChange={(e) => setForm((f) => ({ ...f, external_id: e.target.value }))} />
                  <select value={form.status || ''} className={inputCls}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                    {STATUSES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>

                <label className="flex items-center gap-2 text-xs text-muted cursor-pointer w-fit">
                  <input type="checkbox" checked={!!form.fetch_enabled}
                    onChange={(e) => setForm((f) => ({ ...f, fetch_enabled: e.target.checked }))} />
                  El cron lo actualiza
                </label>

                <button disabled={busy} onClick={() => correr(() => adminUpdateInstrument(it.id, form))}
                  className="px-3 py-1.5 rounded text-xs bg-accent hover:bg-accent/90 text-white disabled:opacity-50">
                  Guardar
                </button>

                <div className="border-t border-bg-border pt-3 space-y-2">
                  <p className="text-xs font-medium">Fusionar con otro activo</p>
                  <p className="text-xs text-muted">
                    Repunta el ledger, suma la historia y reconstruye las posiciones; el original queda
                    apuntando al canónico. Preferilo antes que borrar: borrar cascadea a las posiciones de todos.
                  </p>
                  <input placeholder="buscar destino…" value={mergeQ} className={`${inputCls} w-full`}
                    onChange={async (e) => {
                      const v = e.target.value; setMergeQ(v);
                      if (v.trim().length < 2) { setHits([]); return; }
                      try { setHits((await searchInstruments(v)).instruments || []); } catch { setHits([]); }
                    }} />
                  {mergeHits.filter((h) => h.id !== it.id).map((h) => (
                    <div key={h.id} className="flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded hover:bg-bg-hover">
                      <span className="truncate">
                        {h.name}{h.ticker ? ` (${h.ticker})` : ''}
                        <span className="text-muted"> — {Math.round(h.similarity * 100)}%</span>
                      </span>
                      <button disabled={busy} onClick={() => correr(() => mergeInstrument(it.id, h.id))}
                        className="shrink-0 text-accent hover:underline disabled:opacity-50">fusionar acá</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {data.total > LIMIT && (
        <div className="px-5 py-3 border-t border-bg-border flex items-center justify-between text-xs">
          <span className="text-muted">{offset + 1}–{Math.min(offset + LIMIT, data.total)} de {data.total}</span>
          <div className="flex gap-2">
            <button disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - LIMIT))}
              className="px-2 py-1 rounded border border-bg-border disabled:opacity-40">anterior</button>
            <button disabled={offset + LIMIT >= data.total} onClick={() => setOffset((o) => o + LIMIT)}
              className="px-2 py-1 rounded border border-bg-border disabled:opacity-40">siguiente</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Custodios ────────────────────────────────────────────────────────────────
export function CustodiansPanel() {
  const [list, setList]       = useState([]);
  const [error, setError]     = useState(null);
  const [editing, setEditing] = useState(null);
  const [nombre, setNombre]   = useState('');
  const [busy, setBusy]       = useState(false);
  // Alta desde el panel. El endpoint es el mismo que usan el form de posiciones
  // y la cartola: la lista es corta y los duplicados se fusionan desde acá.
  const [nuevo, setNuevo]     = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try { setList((await adminGetCustodians()).custodians); }
    catch (e) { setError(e.response?.data?.error || e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function correr(fn) {
    setBusy(true); setError(null);
    try { await fn(); setEditing(null); await load(); }
    catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  }

  const activos = list.filter((c) => !c.canonical_id);

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-bg-border flex items-center gap-2">
        <Building2 size={16} className="text-accent" />
        <h3 className="font-medium">Custodios</h3>
        <span className="text-xs text-muted">{activos.length} activos</span>
        <div className="flex-1" />
        {nuevo === null && (
          <button onClick={() => { setNuevo(''); setError(null); }}
            className="flex items-center gap-1 text-xs text-accent hover:underline">
            <Plus size={12} /> Nuevo
          </button>
        )}
      </div>

      {nuevo !== null && (
        <div className="px-5 py-3 border-b border-bg-border flex gap-2">
          <input autoFocus value={nuevo} placeholder="Nombre del custodio"
            onChange={(e) => setNuevo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); correr(async () => { await createCustodian({ name: nuevo.trim() }); setNuevo(null); }); }
              if (e.key === 'Escape') setNuevo(null);
            }}
            className={`${inputCls} flex-1`} />
          <button disabled={busy || nuevo.trim().length < 2}
            onClick={() => correr(async () => { await createCustodian({ name: nuevo.trim() }); setNuevo(null); })}
            className="px-3 py-1.5 rounded text-xs bg-accent hover:bg-accent/90 text-white disabled:opacity-50">
            Crear
          </button>
          <button onClick={() => setNuevo(null)}
            className="px-3 py-1.5 rounded text-xs text-muted hover:bg-bg-hover">Cancelar</button>
        </div>
      )}

      {error && <p className="px-5 py-2 text-xs text-loss">{error}</p>}

      <div className="divide-y divide-bg-border/60">
        {list.map((c) => (
          <div key={c.id} className={`px-5 py-3 ${c.canonical_id ? 'opacity-50' : ''}`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{c.name}</span>
                  <span className="text-xs text-muted">{c.slug}</span>
                  {c.id === 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-muted">centinela</span>
                  )}
                  {c.canonical_name && (
                    <span className="text-[10px] text-muted">→ fusionado en {c.canonical_name}</span>
                  )}
                </div>
                <div className="text-xs text-muted mt-0.5">
                  {c.positions_count} posición(es) · {c.tx_count} tx · {c.statements_count} cartola(s)
                  {c.created_by_email && ` · lo creó ${c.created_by_email}`}
                </div>
              </div>
              {c.id !== 0 && !c.canonical_id && (
                <button
                  onClick={() => {
                    const open = editing !== c.id;
                    setEditing(open ? c.id : null); setNombre(open ? c.name : ''); setError(null);
                  }}
                  className="text-xs text-accent hover:underline shrink-0">
                  {editing === c.id ? 'cerrar' : 'editar'}
                </button>
              )}
            </div>

            {editing === c.id && (
              <div className="mt-3 space-y-3 bg-bg-base/40 rounded-lg p-3">
                <div className="flex gap-2">
                  <input value={nombre} onChange={(e) => setNombre(e.target.value)}
                    className={`${inputCls} flex-1`} />
                  <button disabled={busy} onClick={() => correr(() => adminUpdateCustodian(c.id, { name: nombre }))}
                    className="px-3 py-1.5 rounded text-xs bg-accent hover:bg-accent/90 text-white disabled:opacity-50">
                    Renombrar
                  </button>
                </div>

                <div className="border-t border-bg-border pt-3 space-y-2">
                  <p className="text-xs font-medium">Fusionar en otro custodio</p>
                  <p className="text-xs text-muted">
                    Mueve posiciones, transacciones y cartolas. Si el usuario tenía el mismo activo en los
                    dos, los saldos se suman.
                  </p>
                  {activos.filter((x) => x.id !== c.id && x.id !== 0).map((x) => (
                    <div key={x.id} className="flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded hover:bg-bg-hover">
                      <span className="truncate">{x.name}</span>
                      <button disabled={busy} onClick={() => correr(() => adminMergeCustodian(c.id, x.id))}
                        className="shrink-0 text-accent hover:underline disabled:opacity-50">fusionar acá</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
