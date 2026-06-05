// Endpoints del scraper externo: no requieren JWT, solo CRON_SECRET.
// Montados en index.js ANTES del requireAuth para que no queden bloqueados.
import { Router } from 'express';
import { query } from '../config/db.js';
import { snapshotAllUsers } from '../services/portfolioService.js';

const router = Router();

function requireCronSecret(req, res, next) {
  const secret   = process.env.CRON_SECRET || 'cron-dev-secret';
  const provided = req.headers['x-cron-secret'];
  if (provided !== secret) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// GET /api/prices/pending
router.get('/pending', requireCronSecret, async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
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

  const today = new Date().toISOString().slice(0, 10);

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

export default router;
