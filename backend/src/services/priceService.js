// Fetch de precios: un instrumento a la vez.
//
// Antes este archivo tenía el orquestador completo: un `for` sobre todos los
// instrumentos con sleep(1000) por acción, corriendo dentro de una request HTTP.
// Eso se fue a priceQueue.js. Acá quedan las piezas atómicas que el worker usa.

import { query } from '../config/db.js';
import { todayCL } from '../utils/dates.js';
import { fetchDolar } from './fetchers/dolarFetcher.js';
import { fetchCrypto } from './fetchers/cryptoFetcher.js';
import { fetchStockQuote } from './fetchers/stockUsFetcher.js';
import { fetchStockCl } from './fetchers/stockClFetcher.js';
import { fetchFondoCmf } from './fetchers/fondosCmfFetcher.js';
import { fetchAfpCuota } from './fetchers/afpFetcher.js';

/**
 * La fuente respondió bien pero no tiene dato para la fecha pedida.
 *
 * Se distingue de un error a propósito: pasa en feriados que no están en la
 * tabla y cuando el rezago de publicación es más largo de lo esperado. Tratarlo
 * como falla llenaría la cola de `failed` por algo que es normal, y cualquier
 * alerta se volvería ruido.
 */
export class NoDataError extends Error {
  constructor(message) { super(message); this.name = 'NoDataError'; }
}

// ─── Dólar ────────────────────────────────────────────────────────────────────

/** Trae el dólar observado y lo guarda. Devuelve usd_clp. */
export async function refreshDolar() {
  const { date, usd_clp } = await fetchDolar();
  await query(
    `INSERT INTO exchange_rates (date, usd_clp) VALUES ($1, $2)
     ON CONFLICT (date) DO UPDATE SET usd_clp = EXCLUDED.usd_clp, fetched_at = NOW()`,
    [date, usd_clp]
  );
  return Number(usd_clp);
}

/** Último dólar guardado, para convertir cuando hoy no hay dato. */
export async function latestDolar() {
  const { rows } = await query('SELECT usd_clp FROM exchange_rates ORDER BY date DESC LIMIT 1');
  return rows[0] ? Number(rows[0].usd_clp) : null;
}

// ─── Escritura de precios ─────────────────────────────────────────────────────

/** Guarda un precio fresco, completando la moneda faltante con el dólar dado. */
export async function upsertPrice({ instrumentId, date, priceClp, priceUsd, source, usdClp }) {
  let clp = priceClp ?? null;
  let usd = priceUsd ?? null;
  if (clp == null && usd != null && usdClp) clp = usd * usdClp;
  if (usd == null && clp != null && usdClp) usd = clp / usdClp;

  if (clp == null && usd == null) {
    throw new Error('upsertPrice sin precio en ninguna moneda');
  }

  await query(
    `INSERT INTO prices (instrument_id, date, price_clp, price_usd, source, is_stale)
     VALUES ($1,$2,$3,$4,$5,FALSE)
     ON CONFLICT (instrument_id, date)
     DO UPDATE SET price_clp=EXCLUDED.price_clp, price_usd=EXCLUDED.price_usd,
                   source=EXCLUDED.source, is_stale=FALSE, fetched_at=NOW()`,
    [instrumentId, date, clp, usd, source]
  );
}

/**
 * Copia el último precio conocido a `date`, marcado is_stale.
 *
 * Es un relleno para que la valorización no quede sin precio, no un dato. El
 * flag importa: el cálculo de rentabilidad ignora los tramos stale, porque
 * tratarlos como precio real mete un pico artificial el día que el precio
 * verdadero vuelve.
 */
export async function carryForward(instrumentId, date) {
  const { rows } = await query(
    `SELECT price_clp, price_usd, source FROM prices
     WHERE instrument_id = $1 AND date < $2 ORDER BY date DESC LIMIT 1`,
    [instrumentId, date]
  );
  if (!rows[0]) return false;
  await query(
    `INSERT INTO prices (instrument_id, date, price_clp, price_usd, source, is_stale)
     VALUES ($1,$2,$3,$4,$5,TRUE)
     ON CONFLICT (instrument_id, date) DO NOTHING`,
    [instrumentId, date, rows[0].price_clp, rows[0].price_usd, rows[0].source]
  );
  return true;
}

// ─── Fetch de un instrumento ──────────────────────────────────────────────────

/**
 * Trae el precio de un instrumento para una fecha.
 *
 * Devuelve la fecha que dice LA FUENTE, que no siempre es la pedida: un fondo
 * mutuo consultado hoy puede devolver el valor cuota de anteayer. Quien llama
 * decide qué hacer con esa diferencia — el dato es real y vale guardarlo en su
 * fecha, pero el job de la fecha pedida no queda satisfecho.
 *
 * @returns {Promise<{price_clp:number|null, price_usd:number|null, source:string, date:string}>}
 */
export async function fetchOne(inst, date = todayCL()) {
  switch (inst.api_source) {
    case 'coingecko': {
      const { price_usd, price_clp } = await fetchCrypto(inst.external_id || 'bitcoin');
      // Crypto es spot 24/7: la fuente no tiene fecha propia.
      return { price_usd, price_clp, source: 'coingecko', date };
    }

    case 'yahoo_finance': {
      if (inst.type === 'stock_us') {
        const { price, date: d } = await fetchStockQuote(inst.ticker);
        return { price_usd: price, price_clp: null, source: 'yahoo_finance', date: d || date };
      }
      const { price, date: d } = await fetchStockCl(inst.ticker);
      return { price_clp: price, price_usd: null, source: 'yahoo_finance', date: d || date };
    }

    case 'cmf': {
      const { price_clp, date: d } = await fetchFondoCmf({
        admin: inst.meta?.admin,
        codigo: inst.external_id,
        serie: inst.meta?.serie || 'A',
      });
      if (price_clp == null) throw new NoDataError(`CMF sin valor cuota para ${inst.external_id}`);
      return { price_clp, price_usd: null, source: 'cmf', date: d || date };
    }

    case 'sp': {
      const { price_clp, date: d } = await fetchAfpCuota({
        afp: inst.external_id,
        tipoFondo: inst.meta?.tipo_fondo || 'A',
      });
      if (price_clp == null) throw new NoDataError(`SP sin valor cuota para ${inst.external_id}`);
      return { price_clp, price_usd: null, source: 'sp', date: d || date };
    }

    case 'manual':
      // El precio lo carga el usuario desde la UI. No hay nada que pedir.
      throw new NoDataError('instrumento manual: el precio lo ingresa el usuario');

    default:
      throw new Error(`api_source desconocido: ${inst.api_source}`);
  }
}

// ─── Compatibilidad ───────────────────────────────────────────────────────────

/**
 * Refresca todos los precios. Ahora encola y drena la cola en lotes, en vez de
 * recorrer los instrumentos de a uno dentro de la request.
 *
 * Lo siguen usando `POST /api/prices/refresh` (fire-and-forget) y el job manual
 * `npm run fetch:prices`. El cron de GitHub Actions usa los endpoints de la cola
 * directamente, que es lo que le permite no depender de un timeout.
 */
export async function refreshAllPrices({ date = todayCL(), maxBatches = 40, limit = 25 } = {}) {
  // Import diferido: priceQueue importa de este archivo.
  const { enqueue, runBatch } = await import('./priceQueue.js');

  const enq = await enqueue({ date });
  const totales = { date, encolados: enq.created, ok: 0, no_data: 0, failed: 0, lotes: 0 };

  for (let i = 0; i < maxBatches; i++) {
    const r = await runBatch({ limit });
    totales.ok += r.ok;
    totales.no_data += r.no_data;
    totales.failed += r.failed;
    totales.lotes++;
    if (r.tomados === 0 || r.pending === 0) break;
  }

  console.log('[priceService] refresh listo:', totales);
  return totales;
}
