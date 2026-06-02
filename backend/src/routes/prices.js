// Precios: últimos disponibles, historial, refresh manual y carga manual (FIP).
import { Router } from 'express';
import { query } from '../config/db.js';
import { refreshAllPrices } from '../services/priceService.js';
import { snapshotAllUsers } from '../services/portfolioService.js';

const router = Router();

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

// POST /api/prices/refresh -> dispara fetch de todos los precios + snapshots (dev/manual)
router.post('/refresh', async (req, res) => {
  try {
    const report = await refreshAllPrices();
    const snapshots = await snapshotAllUsers(report.date);
    res.json({ report, snapshots });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
