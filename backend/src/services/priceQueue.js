// Cola de fetches de precio.
//
// Reemplaza el `for` secuencial que corría dentro de una request HTTP. Ahora:
//
//   enqueue()  decide qué falta y crea una fila por (instrumento, fecha)
//   runBatch() toma un lote chico, lo procesa en paralelo por fuente y responde
//              en segundos, devolviendo cuántos quedan
//
// El que llama (GitHub Actions) hace runBatch en loop hasta pending = 0. El
// tiempo total deja de vivir dentro de un timeout de curl.

import { query, pool } from '../config/db.js';
import { todayCL } from '../utils/dates.js';
import { lastExpectedDate, gapsFor, marketOf, isTradingDay } from './marketCalendar.js';
import { fetchOne, upsertPrice, carryForward, refreshDolar, latestDolar, NoDataError } from './priceService.js';

// Cuántos fetches en paralelo tolera cada fuente sin que empiece a devolver 429.
// CoinGecko comparte cuota por IP en el plan gratis, así que va de a uno.
const CONCURRENCY = {
  coingecko:     1,
  yahoo_finance: 4,
  cmf:           2,
  sp:            2,
  default:       2,
};

const MAX_ATTEMPTS = 4;
// Backoff en minutos: 5, 20, 60. Un fondo que publica con rezago se resuelve
// solo en la corrida del día siguiente, no hace falta reintentar agresivo.
const BACKOFF_MIN = [5, 20, 60];

// Lock para que las tres entradas de escritura de precios no se pisen: el tick
// de GitHub Actions, el refresh manual desde la UI y el scraper externo.
const LOCK_KEY = 918273645;

/** Corre `fn` solo si nadie más tiene el lock. Devuelve null si estaba tomado. */
export async function withPriceLock(fn) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
    if (!rows[0].ok) return null;
    try {
      return await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

/**
 * Crea los jobs que faltan.
 *
 * Para cada instrumento activo con fetch_enabled, encola su última fecha
 * esperada más los huecos hábiles de los últimos días. Los huecos son la parte
 * que el cron viejo no hacía: cuando una fuente volvía después de estar caída,
 * pedía solo hoy y los días perdidos quedaban is_stale para siempre.
 */
export async function enqueue({ date = todayCL(), lookbackDays = 15 } = {}) {
  const { rows: instruments } = await query(
    `SELECT id, name, type, api_source
     FROM instruments
     WHERE fetch_enabled
       AND status = 'active'
       AND canonical_id IS NULL
       AND api_source <> 'manual'`
  );

  let created = 0;
  let skipped = 0;
  const fechas = [];

  for (const inst of instruments) {
    const objetivo = await lastExpectedDate(inst.type, date);

    // Si el mercado no opera ese día no hay nada que pedir.
    if (!(await isTradingDay(marketOf(inst.type), objetivo))) { skipped++; continue; }

    const huecos = await gapsFor(inst.id, inst.type, date, lookbackDays);
    const objetivos = new Set([objetivo, ...huecos]);

    for (const d of objetivos) {
      // Los `done` no se tocan. Los `no_data` sí se reabren: si un día quedó
      // resuelto con carry-forward porque la fuente venía atrasada, mañana
      // puede tener el dato real. Sin esto el hueco quedaría stale para
      // siempre, porque price_gaps lo sigue listando pero el job ya existía.
      const { rowCount } = await query(
        `INSERT INTO price_fetch_jobs (instrument_id, date)
         VALUES ($1, $2)
         ON CONFLICT (instrument_id, date) DO UPDATE
           SET status = 'pending', next_retry_at = NULL, locked_at = NULL, updated_at = NOW()
           WHERE price_fetch_jobs.status = 'no_data'
             AND price_fetch_jobs.attempts < $3`,
        [inst.id, d, MAX_ATTEMPTS]
      );
      created += rowCount;
      if (rowCount) fechas.push(`${inst.name}@${d}`);
    }
  }

  // Los jobs que un worker tomó y nunca cerró (proceso muerto, deploy a mitad).
  const { rowCount: recuperados } = await query(
    `UPDATE price_fetch_jobs
     SET status = 'pending', locked_at = NULL
     WHERE status = 'running' AND locked_at < NOW() - INTERVAL '10 minutes'`
  );

  const { rows: [{ pending }] } = await query(
    `SELECT count(*)::int AS pending FROM price_fetch_jobs
     WHERE status IN ('pending','failed')
       AND (next_retry_at IS NULL OR next_retry_at <= NOW())
       AND attempts < $1`,
    [MAX_ATTEMPTS]
  );

  return { date, instruments: instruments.length, created, skipped, recuperados, pending, muestra: fechas.slice(0, 10) };
}

/** Toma hasta `limit` jobs y los marca running, sin pisarse con otros workers. */
async function claim(limit) {
  const { rows } = await query(
    `WITH tomados AS (
       SELECT j.id
       FROM price_fetch_jobs j
       WHERE j.status IN ('pending','failed')
         AND (j.next_retry_at IS NULL OR j.next_retry_at <= NOW())
         AND j.attempts < $2
       ORDER BY j.next_retry_at NULLS FIRST, j.id
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE price_fetch_jobs j
     SET status = 'running', locked_at = NOW(), updated_at = NOW()
     FROM tomados t
     WHERE j.id = t.id
     RETURNING j.id, j.instrument_id, j.date, j.attempts`,
    [limit, MAX_ATTEMPTS]
  );
  if (rows.length === 0) return [];

  // Los datos del instrumento, en una sola query en vez de una por job.
  const { rows: instruments } = await query(
    `SELECT id, name, type, ticker, currency, api_source, external_id, meta
     FROM instruments WHERE id = ANY($1)`,
    [rows.map((r) => r.instrument_id)]
  );
  const byId = new Map(instruments.map((i) => [i.id, i]));

  return rows.map((j) => ({
    ...j,
    date: typeof j.date === 'string' ? j.date.slice(0, 10) : j.date.toISOString().slice(0, 10),
    instrument: byId.get(j.instrument_id),
  }));
}

async function markDone(job, source) {
  await query(
    `UPDATE price_fetch_jobs
     SET status='done', source_used=$2, last_error=NULL, locked_at=NULL,
         attempts=attempts+1, updated_at=NOW()
     WHERE id=$1`,
    [job.id, source]
  );
}

/**
 * La fuente respondió pero no tiene dato para ese día: feriado no cargado,
 * rezago más largo de lo esperado, instrumento que dejó de cotizar. Se hace
 * carry-forward y se cierra el job — no es un error y no debe alarmar.
 */
async function markNoData(job, motivo) {
  await carryForward(job.instrument_id, job.date);
  await query(
    `UPDATE price_fetch_jobs
     SET status='no_data', last_error=$2, locked_at=NULL,
         attempts=attempts+1, updated_at=NOW()
     WHERE id=$1`,
    [job.id, motivo?.slice(0, 500) ?? null]
  );
}

async function markFailed(job, error) {
  const attempts = job.attempts + 1;
  const agotado = attempts >= MAX_ATTEMPTS;
  const espera = BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)];

  // Mientras quedan intentos, carry-forward para que la valorización no quede
  // sin precio; el job vuelve a intentar más tarde.
  await carryForward(job.instrument_id, job.date);

  await query(
    `UPDATE price_fetch_jobs
     SET status='failed', last_error=$2, attempts=$3, locked_at=NULL,
         next_retry_at = CASE WHEN $4 THEN NULL ELSE NOW() + ($5 || ' minutes')::interval END,
         updated_at=NOW()
     WHERE id=$1`,
    [job.id, String(error?.message || error).slice(0, 500), attempts, agotado, String(espera)]
  );
}

/** Corre `tareas` con como máximo `n` en vuelo a la vez. */
async function pool_(tareas, n) {
  const enVuelo = new Set();
  for (const t of tareas) {
    const p = t().finally(() => enVuelo.delete(p));
    enVuelo.add(p);
    if (enVuelo.size >= n) await Promise.race(enVuelo);
  }
  await Promise.all(enVuelo);
}

/**
 * Procesa un lote. Devuelve el resumen y cuántos jobs quedan pendientes, para
 * que el que llama sepa si tiene que volver.
 */
export async function runBatch({ limit = 25 } = {}) {
  const jobs = await claim(limit);
  const report = { tomados: jobs.length, ok: 0, no_data: 0, failed: 0, pending: 0, detalle: [] };

  if (jobs.length === 0) {
    const { rows: [{ pending }] } = await query(
      `SELECT count(*)::int AS pending FROM price_fetch_jobs
       WHERE status IN ('pending','failed')
         AND (next_retry_at IS NULL OR next_retry_at <= NOW()) AND attempts < $1`,
      [MAX_ATTEMPTS]
    );
    report.pending = pending;
    return report;
  }

  // El dólar antes que nada: se usa para convertir monedas.
  let usdClp = await latestDolar();
  try { usdClp = await refreshDolar(); } catch { /* se sigue con el último */ }

  // Agrupar por fuente para respetar la concurrencia de cada una.
  const porFuente = new Map();
  for (const j of jobs) {
    const src = j.instrument?.api_source || 'default';
    if (!porFuente.has(src)) porFuente.set(src, []);
    porFuente.get(src).push(j);
  }

  await Promise.all([...porFuente.entries()].map(([src, lista]) => {
    const n = CONCURRENCY[src] ?? CONCURRENCY.default;
    return pool_(lista.map((job) => async () => {
      const label = `${job.instrument?.name || job.instrument_id}@${job.date}`;
      try {
        if (!job.instrument) throw new Error('instrumento inexistente');
        const r = await fetchOne(job.instrument, job.date);

        // La fuente dice para qué fecha es el dato, y no siempre es la pedida:
        // un fondo mutuo consultado hoy puede devolver el valor cuota de
        // anteayer. El dato es real y se guarda en SU fecha; el job de la fecha
        // pedida queda sin satisfacer y se resuelve con carry-forward.
        const fechaFuente = r.date || job.date;
        await upsertPrice({
          instrumentId: job.instrument_id, date: fechaFuente,
          priceClp: r.price_clp, priceUsd: r.price_usd,
          source: r.source, usdClp,
        });

        if (fechaFuente === job.date) {
          await markDone(job, r.source);
          report.ok++;
          report.detalle.push(`ok ${label}`);
        } else {
          await markNoData(job, `la fuente devolvió ${fechaFuente}`);
          report.no_data++;
          report.detalle.push(`sin dato ${label} (la fuente dio ${fechaFuente})`);
        }
      } catch (e) {
        if (e instanceof NoDataError) {
          await markNoData(job, e.message);
          report.no_data++;
          report.detalle.push(`sin dato ${label}`);
        } else {
          await markFailed(job, e);
          report.failed++;
          report.detalle.push(`falló ${label}: ${e.message}`);
        }
      }
    }), n);
  }));

  const { rows: [{ pending }] } = await query(
    `SELECT count(*)::int AS pending FROM price_fetch_jobs
     WHERE status IN ('pending','failed')
       AND (next_retry_at IS NULL OR next_retry_at <= NOW()) AND attempts < $1`,
    [MAX_ATTEMPTS]
  );
  report.pending = pending;
  report.detalle = report.detalle.slice(0, 20);
  return report;
}

/** Estado de la cola, para el panel admin y para diagnosticar. */
export async function queueStatus(date = todayCL()) {
  const { rows: porEstado } = await query(
    `SELECT status, count(*)::int AS n FROM price_fetch_jobs WHERE date = $1 GROUP BY status`,
    [date]
  );
  const { rows: rotos } = await query(
    `SELECT i.name, j.date, j.attempts, j.last_error
     FROM price_fetch_jobs j JOIN instruments i ON i.id = j.instrument_id
     WHERE j.status = 'failed' AND j.attempts >= $1
     ORDER BY j.date DESC, i.name
     LIMIT 20`,
    [MAX_ATTEMPTS]
  );
  return { date, por_estado: Object.fromEntries(porEstado.map((r) => [r.status, r.n])), agotados: rotos };
}
