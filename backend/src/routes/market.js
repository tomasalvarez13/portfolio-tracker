// Vista de mercado del día: dólar, BTC y las acciones, con variación vs día previo.
import { Router } from 'express';
import { query } from '../config/db.js';

const router = Router();

// GET /api/market
router.get('/', async (req, res) => {
  // Dólar: hoy y anterior
  const { rows: dolarRows } = await query(
    `SELECT date, usd_clp FROM exchange_rates ORDER BY date DESC LIMIT 2`
  );
  const dolar = dolarRows[0]
    ? {
        date: dolarRows[0].date,
        usd_clp: Number(dolarRows[0].usd_clp),
        change_pct: dolarRows[1]
          ? ((Number(dolarRows[0].usd_clp) - Number(dolarRows[1].usd_clp)) / Number(dolarRows[1].usd_clp)) * 100
          : null,
      }
    : null;

  // Instrumentos de mercado (crypto + acciones): último precio + anterior para variación
  const { rows } = await query(
    `WITH ranked AS (
       SELECT p.instrument_id, p.date, p.price_clp, p.price_usd, p.is_stale,
              ROW_NUMBER() OVER (PARTITION BY p.instrument_id ORDER BY p.date DESC) AS rn
       FROM prices p
     )
     SELECT i.id, i.name, i.ticker, i.type, i.currency,
            cur.price_usd AS cur_usd, cur.price_clp AS cur_clp, cur.date AS cur_date, cur.is_stale,
            prev.price_usd AS prev_usd, prev.price_clp AS prev_clp
     FROM instruments i
     JOIN ranked cur ON cur.instrument_id = i.id AND cur.rn = 1
     LEFT JOIN ranked prev ON prev.instrument_id = i.id AND prev.rn = 2
     WHERE i.type IN ('crypto','stock_us','stock_cl')
     ORDER BY i.type, i.name`
  );

  const instruments = rows.map((r) => {
    const curUsd = r.cur_usd != null ? Number(r.cur_usd) : null;
    const prevUsd = r.prev_usd != null ? Number(r.prev_usd) : null;
    const curClp = r.cur_clp != null ? Number(r.cur_clp) : null;
    const prevClp = r.prev_clp != null ? Number(r.prev_clp) : null;
    const ref = curUsd ?? curClp;
    const prevRef = prevUsd ?? prevClp;
    return {
      id: r.id, name: r.name, ticker: r.ticker, type: r.type, currency: r.currency,
      price_usd: curUsd, price_clp: curClp, date: r.cur_date, is_stale: r.is_stale,
      change_pct: prevRef && ref ? ((ref - prevRef) / prevRef) * 100 : null,
    };
  });

  res.json({ dolar, instruments });
});

export default router;
