// Fetch de precios: un instrumento a la vez, por fecha o por rango.
//
// Antes este archivo tenía el orquestador completo: un `for` sobre todos los
// instrumentos con sleep(1000) por acción, corriendo dentro de una request HTTP.
// Eso se fue a priceQueue.js. Acá quedan las piezas atómicas que el worker usa.

import { query } from '../config/db.js';
import { todayCL } from '../utils/dates.js';
import { fetchSerieDolar } from './fetchers/dolarFetcher.js';
import { fetchCrypto } from './fetchers/cryptoFetcher.js';
import { fetchSerieStockQuote } from './fetchers/stockUsFetcher.js';
import { fetchSerieStockCl } from './fetchers/stockClFetcher.js';
import { fetchSerieFondoCmf } from './fetchers/fondosCmfFetcher.js';
import { fetchSerieAfpCuota } from './fetchers/afpFetcher.js';

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

/**
 * Guarda el dólar observado de todo un rango. Devuelve un Map fecha -> usd_clp.
 *
 * Es el mismo request que refreshDolar: mindicador devuelve la serie completa y
 * antes se descartaba todo menos el primer punto.
 */
export async function refreshDolarRango(since, until) {
  const serie = await fetchSerieDolar(since, until);
  if (serie.length === 0) return new Map();

  await query(
    `INSERT INTO exchange_rates (date, usd_clp)
     SELECT * FROM unnest($1::date[], $2::numeric[])
     ON CONFLICT (date) DO UPDATE SET usd_clp = EXCLUDED.usd_clp, fetched_at = NOW()`,
    [serie.map((p) => p.date), serie.map((p) => p.usd_clp)]
  );
  return new Map(serie.map((p) => [p.date, Number(p.usd_clp)]));
}

/**
 * Devuelve una función `(fecha) => usd_clp` para convertir monedas.
 *
 * Importa que sea por fecha y no un único valor: un precio del 20-ago convertido
 * con el dólar de hoy queda mal por lo que se haya movido el tipo de cambio, y
 * llenar ventanas completas escribe justamente muchas fechas pasadas.
 *
 * Los días sin dato propio —fin de semana, feriado— toman el último anterior,
 * que es lo que hace el Banco Central con el dólar observado.
 */
export async function resolverDolar(since, until) {
  const mapa = new Map();
  try {
    for (const [f, v] of await refreshDolarRango(since, until)) mapa.set(f, v);
  } catch {
    // Sin red se sigue con lo que ya esté guardado.
  }

  const { rows } = await query(
    `SELECT date::text AS date, usd_clp FROM exchange_rates
     WHERE date <= $1 AND date >= $2::date - 60 ORDER BY date`,
    [until, since]
  );
  for (const r of rows) if (!mapa.has(r.date)) mapa.set(r.date, Number(r.usd_clp));

  const fechas = [...mapa.keys()].sort();
  const ultimo = await latestDolar();

  return (fecha) => {
    if (mapa.has(fecha)) return mapa.get(fecha);
    let previa = null;
    for (const f of fechas) {
      if (f > fecha) break;
      previa = f;
    }
    return previa ? mapa.get(previa) : ultimo;
  };
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
 * Todos los precios de un instrumento en un rango de fechas.
 *
 * Es la pieza que faltaba. `fetchOne` recibe una fecha y no se la pasa a nadie:
 * las fuentes devuelven siempre su último valor, así que cualquier job de una
 * fecha que no fuera la última era imposible de satisfacer y terminaba tapado
 * con carry-forward. Un fondo con 11 días de ventana generaba 11 jobs de los
 * que 10 no podían cerrar nunca.
 *
 * Con el rango es un request por instrumento y la ventana se llena con dato
 * real. Las fechas que la fuente no tenga simplemente no vienen en el resultado.
 *
 * @returns {Promise<Array<{date, price_clp, price_usd, source}>>}
 */
export async function fetchRange(inst, since, until) {
  switch (inst.api_source) {
    case 'coingecko': {
      // Spot 24/7 sin historia en el plan gratis: solo puede satisfacer hoy.
      const hoy = todayCL();
      if (hoy < since || hoy > until) return [];
      const { price_usd, price_clp } = await fetchCrypto(inst.external_id || 'bitcoin');
      return [{ date: hoy, price_clp, price_usd, source: 'coingecko' }];
    }

    case 'yahoo_finance': {
      const esUs = inst.type === 'stock_us';
      const serie = esUs
        ? await fetchSerieStockQuote(inst.ticker, since, until)
        : await fetchSerieStockCl(inst.ticker, since, until);
      return serie.map(({ date, price }) => ({
        date,
        price_clp: esUs ? null : price,
        price_usd: esUs ? price : null,
        source: 'yahoo_finance',
      }));
    }

    case 'cmf': {
      const serie = await fetchSerieFondoCmf({
        admin: inst.meta?.admin,
        codigo: inst.external_id,
        serie: inst.meta?.serie || 'A',
        since,
        until,
      });
      return serie.map(({ date, price_clp }) => ({
        date, price_clp, price_usd: null, source: 'cmf',
      }));
    }

    case 'sp': {
      const serie = await fetchSerieAfpCuota({
        afp: inst.external_id,
        tipoFondo: inst.meta?.tipo_fondo || 'A',
        since,
        until,
      });
      return serie.map(({ date, price_clp }) => ({
        date, price_clp, price_usd: null, source: 'sp',
      }));
    }

    case 'manual':
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
