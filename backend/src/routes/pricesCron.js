// Endpoints del scraper externo: no requieren JWT, solo CRON_SECRET.
// Montados en index.js ANTES del requireAuth para que no queden bloqueados.
import { Router } from 'express';
import { query } from '../config/db.js';
import { snapshotAllUsers } from '../services/portfolioService.js';
import { enqueue, runBatch, queueStatus, withPriceLock } from '../services/priceQueue.js';
import { todayCL } from '../utils/dates.js';

const router = Router();

function requireCronSecret(req, res, next) {
  const secret   = process.env.CRON_SECRET || 'cron-dev-secret';
  const provided = req.headers['x-cron-secret'];
  if (provided !== secret) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// GET /api/prices/pending
router.get('/pending', requireCronSecret, async (req, res) => {
  const today = todayCL();
  const { rows } = await query(
    `SELECT i.id, i.name, i.alias, i.ticker, i.type, i.currency,
            i.api_source, i.external_id, i.meta
     FROM instruments i
     WHERE i.api_source != 'manual'
       AND NOT EXISTS (
         SELECT 1 FROM prices p
         WHERE p.instrument_id = i.id
           AND p.date = $1
           AND p.is_stale = FALSE
       )
     ORDER BY i.type, i.name`,
    [today]
  );
  res.json({ date: today, count: rows.length, instruments: rows });
});

// POST /api/prices/batch
router.post('/batch', requireCronSecret, async (req, res) => {
  const { prices } = req.body;
  if (!Array.isArray(prices) || prices.length === 0) {
    return res.status(400).json({ error: 'prices[] es obligatorio y debe ser un array no vacío' });
  }

  const today = todayCL();

  const { rows: dolarRows } = await query(
    'SELECT usd_clp FROM exchange_rates ORDER BY date DESC LIMIT 1'
  );
  const usdClp = dolarRows[0] ? Number(dolarRows[0].usd_clp) : null;

  const ok = []; const failed = [];

  for (const p of prices) {
    const { instrument_id, price_clp, price_usd, date, source = 'scraper' } = p;
    if (!instrument_id) { failed.push({ ...p, error: 'instrument_id requerido' }); continue; }
    try {
      let clp = price_clp ?? null;
      let usd = price_usd ?? null;
      if (clp == null && usd != null && usdClp) clp = usd * usdClp;
      if (usd == null && clp != null && usdClp) usd = clp / usdClp;

      await query(
        `INSERT INTO prices (instrument_id, date, price_clp, price_usd, source, is_stale)
         VALUES ($1, $2, $3, $4, $5, FALSE)
         ON CONFLICT (instrument_id, date)
         DO UPDATE SET price_clp  = EXCLUDED.price_clp,
                       price_usd  = EXCLUDED.price_usd,
                       source     = EXCLUDED.source,
                       is_stale   = FALSE,
                       fetched_at = NOW()`,
        [instrument_id, date || today, clp, usd, source]
      );
      ok.push(instrument_id);
    } catch (e) {
      failed.push({ instrument_id, error: e.message });
    }
  }

  try { await snapshotAllUsers(today); } catch {}

  res.json({ ok: ok.length, failed: failed.length, date: today, failures: failed });
});

// ─── COLA DE PRECIOS ──────────────────────────────────────────────────────────
//
// El flujo que reemplaza al fetch monolítico:
//
//   POST /api/prices/enqueue        decide qué falta y lo encola
//   POST /api/prices/run?limit=25   procesa un lote, responde en segundos
//
// GitHub Actions llama run en loop hasta que pending llega a 0, así el tiempo
// total del refresh deja de estar limitado por el timeout de una request.

// POST /api/prices/enqueue
router.post('/enqueue', requireCronSecret, async (req, res) => {
  try {
    const r = await enqueue({
      date: req.body?.date || todayCL(),
      lookbackDays: Number(req.body?.lookback_days) || 15,
    });
    res.json(r);
  } catch (e) {
    console.error('[prices/enqueue]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/prices/run?limit=25
//
// El advisory lock evita que dos workers —o un tick y un refresh manual— se
// pisen. Si está tomado responde 409 en vez de duplicar trabajo: el que llama
// reintenta en el siguiente ciclo.
router.post('/run', requireCronSecret, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
  try {
    const r = await withPriceLock(() => runBatch({ limit }));
    if (r === null) {
      return res.status(409).json({ error: 'Ya hay un worker corriendo', pending: null });
    }
    // Snapshot solo cuando la cola se vació: hacerlo por lote sería recalcular
    // el portafolio de todos los usuarios N veces en la misma corrida.
    if (r.pending === 0 && r.ok > 0) {
      try { await snapshotAllUsers(todayCL()); } catch (e) { console.error('[prices/run] snapshot:', e.message); }
    }
    res.json(r);
  } catch (e) {
    console.error('[prices/run]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/prices/queue
router.get('/queue', requireCronSecret, async (req, res) => {
  try {
    res.json(await queueStatus(req.query.date || todayCL()));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
