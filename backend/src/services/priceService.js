// Orquestador de precios: recorre todos los instrumentos, llama al fetcher que
// corresponde según api_source, convierte monedas con el dólar del día y hace
// upsert en `prices` y `exchange_rates`.
//
// Manejo de errores: si un instrumento falla, se hace "carry-forward" del último
// precio disponible marcándolo is_stale=true, y se continúa con el resto.

import { query, supabaseAdmin } from '../config/db.js';
import { fetchDolar } from './fetchers/dolarFetcher.js';
import { fetchCrypto } from './fetchers/cryptoFetcher.js';
import { fetchStockQuote } from './fetchers/stockUsFetcher.js';
import { fetchStockCl } from './fetchers/stockClFetcher.js';
import { fetchFondoCmf } from './fetchers/fondosCmfFetcher.js';
import { fetchAfpCuota } from './fetchers/afpFetcher.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const todayISO = () => new Date().toISOString().slice(0, 10);

/** Upsert del dólar observado del día. Devuelve usd_clp. */
async function upsertDolar() {
  const { date, usd_clp } = await fetchDolar();
  await query(
    `INSERT INTO exchange_rates (date, usd_clp)
     VALUES ($1, $2)
     ON CONFLICT (date) DO UPDATE SET usd_clp = EXCLUDED.usd_clp, fetched_at = NOW()`,
    [date, usd_clp]
  );
  return usd_clp;
}

/** Último dólar disponible (para convertir si hoy no hay dato). */
async function getLatestDolar() {
  const { rows } = await query(
    `SELECT usd_clp FROM exchange_rates ORDER BY date DESC LIMIT 1`
  );
  return rows[0] ? Number(rows[0].usd_clp) : null;
}

/** Carry-forward: copia el último precio disponible al día de hoy, marcado stale. */
async function carryForward(instrumentId, date) {
  const { rows } = await query(
    `SELECT price_clp, price_usd, source FROM prices
     WHERE instrument_id = $1 AND date < $2
     ORDER BY date DESC LIMIT 1`,
    [instrumentId, date]
  );
  if (!rows[0]) return false;
  const { price_clp, price_usd, source } = rows[0];
  await query(
    `INSERT INTO prices (instrument_id, date, price_clp, price_usd, source, is_stale)
     VALUES ($1, $2, $3, $4, $5, TRUE)
     ON CONFLICT (instrument_id, date) DO NOTHING`,
    [instrumentId, date, price_clp, price_usd, source]
  );
  return true;
}

/** Guarda un precio fresco, completando la moneda faltante con el dólar dado. */
async function savePrice({ instrumentId, date, priceClp, priceUsd, source, usdClp }) {
  let clp = priceClp ?? null;
  let usd = priceUsd ?? null;
  if (clp == null && usd != null && usdClp) clp = usd * usdClp;
  if (usd == null && clp != null && usdClp) usd = clp / usdClp;

  await query(
    `INSERT INTO prices (instrument_id, date, price_clp, price_usd, source, is_stale)
     VALUES ($1, $2, $3, $4, $5, FALSE)
     ON CONFLICT (instrument_id, date)
     DO UPDATE SET price_clp = EXCLUDED.price_clp,
                   price_usd = EXCLUDED.price_usd,
                   source    = EXCLUDED.source,
                   is_stale  = FALSE,
                   fetched_at = NOW()`,
    [instrumentId, date, clp, usd, source]
  );
}

/**
 * Ejecuta el fetch de precios de TODOS los instrumentos.
 * @returns {Promise<{date:string, usdClp:number, ok:string[], stale:string[], failed:string[]}>}
 */
export async function refreshAllPrices() {
  const date = todayISO();
  const report = { date, usdClp: null, ok: [], stale: [], failed: [] };

  // 1. Dólar primero (lo necesitamos para convertir).
  let usdClp;
  try {
    usdClp = await upsertDolar();
  } catch (e) {
    console.error('[priceService] dólar falló, usando último disponible:', e.message);
    usdClp = await getLatestDolar();
  }
  report.usdClp = usdClp;

  // 2. Instrumentos.
  const { rows: instruments } = await query(
    `SELECT id, name, type, ticker, currency, api_source, external_id, meta FROM instruments`
  );

  for (const inst of instruments) {
    const label = inst.ticker || inst.name;
    try {
      switch (inst.api_source) {
        case 'coingecko': {
          const { price_usd, price_clp } = await fetchCrypto(inst.external_id || 'bitcoin');
          await savePrice({ instrumentId: inst.id, date, priceUsd: price_usd, priceClp: price_clp, source: 'coingecko', usdClp });
          report.ok.push(label);
          break;
        }
        case 'alpha_vantage': {
          const { price, currency } = await fetchStockQuote(inst.ticker);
          const args = currency === 'CLP'
            ? { priceClp: price }
            : { priceUsd: price };
          await savePrice({ instrumentId: inst.id, date, ...args, source: 'alpha_vantage', usdClp });
          report.ok.push(label);
          await sleep(15000); // respetar rate limit (~5/min)
          break;
        }
        case 'yahoo_finance': {
          const { price } = await fetchStockCl(inst.ticker);
          await savePrice({ instrumentId: inst.id, date, priceClp: price, source: 'yahoo_finance', usdClp });
          report.ok.push(label);
          await sleep(1000); // Yahoo Finance no tiene rate limit estricto
          break;
        }
        case 'cmf': {
          const admin = inst.meta?.admin;
          const serie = inst.meta?.serie || 'A';
          const { price_clp } = await fetchFondoCmf({ admin, codigo: inst.external_id, serie });
          await savePrice({ instrumentId: inst.id, date, priceClp: price_clp, source: 'cmf', usdClp });
          report.ok.push(label);
          break;
        }
        case 'sp': {
          const tipoFondo = inst.meta?.tipo_fondo || 'A';
          const { price_clp } = await fetchAfpCuota({ afp: inst.external_id, tipoFondo });
          await savePrice({ instrumentId: inst.id, date, priceClp: price_clp, source: 'sp', usdClp });
          report.ok.push(label);
          break;
        }
        case 'manual':
          // Precio lo ingresa el usuario desde la UI. Hacemos carry-forward.
          if (await carryForward(inst.id, date)) report.stale.push(label);
          break;
        default:
          report.failed.push(`${label} (api_source desconocido)`);
      }
    } catch (e) {
      console.error(`[priceService] ${label} falló: ${e.message}`);
      const carried = await carryForward(inst.id, date);
      if (carried) report.stale.push(label);
      else report.failed.push(label);
    }
  }

  console.log('[priceService] refresh listo:', {
    ok: report.ok.length, stale: report.stale.length, failed: report.failed.length,
  });
  return report;
}
