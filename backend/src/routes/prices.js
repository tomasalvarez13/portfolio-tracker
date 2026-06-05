// Precios: últimos disponibles, historial, refresh manual y carga manual (FIP).
import { Router } from 'express';
import { query } from '../config/db.js';
import { refreshAllPrices } from '../services/priceService.js';
import { snapshotAllUsers } from '../services/portfolioService.js';

const router = Router();

// Middleware: protege endpoints del scraper externo con CRON_SECRET
function requireCronSecret(req, res, next) {
  const secret   = process.env.CRON_SECRET || 'cron-dev-secret';
  const provided = req.headers['x-cron-secret'];
  if (provided !== secret) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// GET /api/prices/latest -> último precio de cada instrumento + dólar del día
router.get('/latest', async (req, res) => {
  const { rows } = await query(
    `SELECT lp.instrument_id, i.name, i.ticker, i.type, i.currency,
            lp.price_clp, lp.price_usd, lp.date, lp.is_stale, lp.source
     FROM latest_prices lp JOIN instruments i ON i.id = lp.instrument_id
     ORDER BY i.type, i.name`
  );
  const { rows: dolar } = await query(
    `SELECT usd_clp, date FROM exchange_rates ORDER BY date DESC LIMIT 1`
  );
  res.json({ prices: rows, dolar: dolar[0] || null });
});

// GET /api/prices/:instrumentId?from=&to=
router.get('/:instrumentId', async (req, res) => {
  const { from, to } = req.query;
  const clauses = ['instrument_id = $1'];
  const params = [req.params.instrumentId];
  if (from) { params.push(from); clauses.push(`date >= $${params.length}`); }
  if (to) { params.push(to); clauses.push(`date <= $${params.length}`); }
  const { rows } = await query(
    `SELECT date, price_clp, price_usd, is_stale, source FROM prices
     WHERE ${clauses.join(' AND ')} ORDER BY date ASC`,
    params
  );
  res.json(rows);
});

// POST /api/prices/manual  { instrument_id, date, price_clp?, price_usd? }
// Para instrumentos api_source='manual' (FIP Venturance). Actualiza el día.
router.post('/manual', async (req, res) => {
  const { instrument_id, date, price_clp, price_usd } = req.body;
  if (!instrument_id || !date) {
    return res.status(400).json({ error: 'instrument_id y date son obligatorios' });
  }
  if (price_clp == null && price_usd == null) {
    return res.status(400).json({ error: 'Indica price_clp o price_usd' });
  }
  const { rows } = await query(
    `INSERT INTO prices (instrument_id, date, price_clp, price_usd, source, is_stale)
     VALUES ($1,$2,$3,$4,'manual',FALSE)
     ON CONFLICT (instrument_id, date)
     DO UPDATE SET price_clp=$3, price_usd=$4, source='manual', is_stale=FALSE, fetched_at=NOW()
     RETURNING *`,
    [instrument_id, date, price_clp ?? null, price_usd ?? null]
  );
  res.status(201).json(rows[0]);
});

// GET /api/prices/pending -> instrumentos que no tienen precio fresco hoy.
// Protegido con x-cron-secret. Ideal para que un scraper externo sepa qué actualizar.
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

// POST /api/prices/batch -> carga masiva de precios desde scraper externo.
// Body: { prices: [{ instrument_id, price_clp?, price_usd?, date?, source? }] }
// Protegido con x-cron-secret.
router.post('/batch', requireCronSecret, async (req, res) => {
  const { prices } = req.body;
  if (!Array.isArray(prices) || prices.length === 0) {
    return res.status(400).json({ error: 'prices[] es obligatorio y debe ser un array no vacío' });
  }

  const today = new Date().toISOString().slice(0, 10);

  // Último dólar para conversiones
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

  // Regenerar snapshots para reflejar los nuevos precios
  try { await snapshotAllUsers(today); } catch {}

  res.json({ ok: ok.length, failed: failed.length, date: today, failures: failed });
});

// POST /api/prices/refresh -> dispara fetch en background y responde de inmediato.
// Evita timeout de 30s de Render free tier cuando hay muchos instrumentos.
router.post('/refresh', (req, res) => {
  res.json({ ok: true, message: 'Actualización iniciada. Los precios se refrescarán en los próximos minutos.' });
  // Fire-and-forget: no bloquea la respuesta HTTP
  (async () => {
    try {
      const report = await refreshAllPrices();
      await snapshotAllUsers(report.date);
      console.log('[prices/refresh] completado:', {
        ok: report.ok.length, stale: report.stale.length, failed: report.failed.length,
      });
    } catch (e) {
      console.error('[prices/refresh] error en background:', e.message);
    }
  })();
});

export default router;
