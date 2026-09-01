// Cola de fetches de precio.
//
// Reemplaza el `for` secuencial que corría dentro de una request HTTP. Ahora:
//
//   enqueue()  decide qué falta y crea una fila por (instrumento, fecha)
//   runBatch() toma unos pocos instrumentos con TODAS sus fechas pendientes, los
//              procesa en paralelo por fuente —un request por instrumento cubre
//              su ventana completa— y responde en segundos, devolviendo cuántos
//              quedan
//
// El que llama (GitHub Actions) hace runBatch en loop hasta pending = 0. El
// tiempo total deja de vivir dentro de un timeout de curl.

import { query, pool } from '../config/db.js';
import { todayCL } from '../utils/dates.js';
import { lastExpectedDate, gapsFor, marketOf, isTradingDay } from './marketCalendar.js';
import { fetchRange, upsertPrice, carryForward, resolverDolar, NoDataError } from './priceService.js';

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

// ─── Registro de ejecuciones ─────────────────────────────────────────────────
//
// price_fetch_jobs guarda el estado por (instrumento, fecha), pero los jobs se
// reabren y se sobreescriben: mirando esa tabla no se puede reconstruir qué
// pasó en una corrida puntual. job_runs guarda una fila por ejecución.

async function abrirRun({ kind, trigger = 'api', date }) {
  const { rows } = await query(
    `INSERT INTO job_runs (kind, trigger, date) VALUES ($1,$2,$3) RETURNING id`,
    [kind, trigger, date ?? null]
  );
  return rows[0].id;
}

async function cerrarRun(runId, campos) {
  if (!runId) return;
  await query(
    `UPDATE job_runs
     SET finished_at = NOW(), enqueued = $2, claimed = $3, ok = $4,
         no_data = $5, failed = $6, pending_after = $7, error = $8, detail = $9
     WHERE id = $1`,
    [runId, campos.enqueued ?? null, campos.claimed ?? null, campos.ok ?? null,
     campos.no_data ?? null, campos.failed ?? null, campos.pending_after ?? null,
     campos.error ?? null, campos.detail ? JSON.stringify(campos.detail) : null]
  );
}

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
export async function enqueue({ date = todayCL(), lookbackDays = 15, trigger = 'api' } = {}) {
  const runId = await abrirRun({ kind: 'enqueue', trigger, date });
  try {
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

  const resultado = { run_id: runId, date, instruments: instruments.length, created, skipped, recuperados, pending, muestra: fechas.slice(0, 10) };
  await cerrarRun(runId, { enqueued: created, pending_after: pending, detail: { skipped, recuperados, muestra: fechas.slice(0, 20) } });
  return resultado;
  } catch (e) {
    await cerrarRun(runId, { error: String(e.message).slice(0, 500) });
    throw e;
  }
}

/**
 * Toma los jobs de hasta `limit` INSTRUMENTOS y los marca running.
 *
 * La unidad es el instrumento, no el job, porque las fuentes se consultan por
 * rango: un request llena toda la ventana. Antes se tomaban jobs sueltos
 * ordenados por id, y como el enqueue los inserta instrumento por instrumento
 * con todas sus fechas, un lote terminaba siendo un solo instrumento repetido
 * —una llamada por fecha a la misma fuente, y la concurrencia por fuente sin usar.
 *
 * Los instrumentos con la fecha pendiente más reciente van primero: si la
 * corrida se corta, lo que queda sin hacer son los huecos viejos, no el precio
 * de ayer.
 *
 * @returns {Promise<Array<{instrumentId, instrument, jobs}>>}
 */
async function claim(limit, runId) {
  const { rows } = await query(
    `WITH elegibles AS (
       SELECT j.id, j.instrument_id, j.date
       FROM price_fetch_jobs j
       WHERE j.status IN ('pending','failed')
         AND (j.next_retry_at IS NULL OR j.next_retry_at <= NOW())
         AND j.attempts < $2
     ),
     instrumentos AS (
       SELECT instrument_id
       FROM elegibles
       GROUP BY instrument_id
       ORDER BY max(date) DESC, instrument_id
       LIMIT $1
     ),
     tomados AS (
       SELECT j.id
       FROM price_fetch_jobs j
       JOIN instrumentos i ON i.instrument_id = j.instrument_id
       WHERE j.status IN ('pending','failed')
         AND (j.next_retry_at IS NULL OR j.next_retry_at <= NOW())
         AND j.attempts < $2
       FOR UPDATE OF j SKIP LOCKED
     )
     UPDATE price_fetch_jobs j
     SET status = 'running', locked_at = NOW(), updated_at = NOW(), last_run_id = $3
     FROM tomados t
     WHERE j.id = t.id
     RETURNING j.id, j.instrument_id, j.date, j.attempts`,
    [limit, MAX_ATTEMPTS, runId ?? null]
  );
  if (rows.length === 0) return [];

  // Los datos del instrumento, en una sola query en vez de una por job.
  const { rows: instruments } = await query(
    `SELECT id, name, type, ticker, currency, api_source, external_id, meta
     FROM instruments WHERE id = ANY($1)`,
    [[...new Set(rows.map((r) => r.instrument_id))]]
  );
  const byId = new Map(instruments.map((i) => [i.id, i]));

  const grupos = new Map();
  for (const j of rows) {
    const job = {
      ...j,
      date: typeof j.date === 'string' ? j.date.slice(0, 10) : j.date.toISOString().slice(0, 10),
    };
    if (!grupos.has(j.instrument_id)) {
      grupos.set(j.instrument_id, {
        instrumentId: j.instrument_id,
        instrument: byId.get(j.instrument_id),
        jobs: [],
      });
    }
    grupos.get(j.instrument_id).jobs.push(job);
  }

  for (const g of grupos.values()) g.jobs.sort((a, b) => (a.date < b.date ? -1 : 1));
  return [...grupos.values()];
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
 * Procesa un lote: hasta `limit` instrumentos, con todas sus fechas pendientes.
 *
 * Devuelve el resumen y cuántos jobs quedan, para que el que llama sepa si
 * tiene que volver.
 */
export async function runBatch({ limit = 25, trigger = 'api' } = {}) {
  const runId = await abrirRun({ kind: 'run', trigger, date: todayCL() });
  const grupos = await claim(limit, runId);
  const totalJobs = grupos.reduce((n, g) => n + g.jobs.length, 0);
  const report = {
    run_id: runId, tomados: totalJobs, instrumentos: grupos.length,
    ok: 0, no_data: 0, failed: 0, pending: 0, detalle: [],
  };

  if (grupos.length === 0) {
    const { rows: [{ pending }] } = await query(
      `SELECT count(*)::int AS pending FROM price_fetch_jobs
       WHERE status IN ('pending','failed')
         AND (next_retry_at IS NULL OR next_retry_at <= NOW()) AND attempts < $1`,
      [MAX_ATTEMPTS]
    );
    report.pending = pending;
    await cerrarRun(runId, { claimed: 0, ok: 0, no_data: 0, failed: 0, pending_after: pending });
    return report;
  }

  // El dólar antes que nada: se usa para convertir monedas, y tiene que ser el
  // de cada fecha. Llenar ventanas completas escribe muchos días pasados, y
  // convertirlos todos al dólar de hoy los deja mal por lo que se haya movido.
  const fechas = grupos.flatMap((g) => g.jobs.map((j) => j.date)).sort();
  const usdEn = await resolverDolar(fechas[0], fechas[fechas.length - 1]);

  // Agrupar por fuente para respetar la concurrencia de cada una.
  const porFuente = new Map();
  for (const g of grupos) {
    const src = g.instrument?.api_source || 'default';
    if (!porFuente.has(src)) porFuente.set(src, []);
    porFuente.get(src).push(g);
  }

  await Promise.all([...porFuente.entries()].map(([src, lista]) => {
    const n = CONCURRENCY[src] ?? CONCURRENCY.default;
    return pool_(lista.map((g) => async () => {
      const nombre = g.instrument?.name || g.instrumentId;
      try {
        if (!g.instrument) throw new Error('instrumento inexistente');

        // Un solo request por instrumento cubre todas sus fechas pendientes.
        const desde = g.jobs[0].date;
        const hasta = g.jobs[g.jobs.length - 1].date;
        const serie = await fetchRange(g.instrument, desde, hasta);

        // Se guarda todo lo que la fuente trajo, no solo lo que se pidió: si el
        // rango incluye días que todavía no tienen job, quedan resueltos igual.
        for (const punto of serie) {
          await upsertPrice({
            instrumentId: g.instrumentId, date: punto.date,
            priceClp: punto.price_clp, priceUsd: punto.price_usd,
            source: punto.source, usdClp: usdEn(punto.date),
          });
        }

        const porFecha = new Map(serie.map((punto) => [punto.date, punto]));
        for (const job of g.jobs) {
          const punto = porFecha.get(job.date);
          if (punto) {
            await markDone(job, punto.source);
            report.ok++;
            report.detalle.push(`ok ${nombre}@${job.date}`);
          } else {
            // La fuente respondió y esa fecha no está en su serie: feriado que
            // no tenemos en la tabla, instrumento que dejó de cotizar, o un
            // rezago más largo que la ventana.
            await markNoData(job, `la fuente no tiene ${job.date}`);
            report.no_data++;
            report.detalle.push(`sin dato ${nombre}@${job.date}`);
          }
        }
      } catch (e) {
        // El fallo es del instrumento completo: se marcan todos sus jobs.
        for (const job of g.jobs) {
          if (e instanceof NoDataError) {
            await markNoData(job, e.message);
            report.no_data++;
            report.detalle.push(`sin dato ${nombre}@${job.date}`);
          } else {
            await markFailed(job, e);
            report.failed++;
            report.detalle.push(`falló ${nombre}@${job.date}: ${e.message}`);
          }
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
  await cerrarRun(runId, {
    claimed: totalJobs, ok: report.ok, no_data: report.no_data,
    failed: report.failed, pending_after: pending, detail: { detalle: report.detalle },
  });
  return report;
}

/** Últimas ejecuciones del cron. */
export async function listRuns(limit = 40) {
  const { rows } = await query(
    `SELECT id, kind, trigger, date, started_at, finished_at,
            enqueued, claimed, ok, no_data, failed, pending_after, error,
            EXTRACT(EPOCH FROM (COALESCE(finished_at, NOW()) - started_at))::int AS duracion_s
     FROM job_runs ORDER BY started_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

/** Una ejecución con los jobs que tocó. */
export async function getRun(runId) {
  const { rows: [run] } = await query('SELECT * FROM job_runs WHERE id = $1', [runId]);
  if (!run) return null;
  const { rows: jobs } = await query(
    `SELECT j.id, i.name AS instrumento, i.api_source, j.date, j.status,
            j.attempts, j.last_error, j.source_used
     FROM price_fetch_jobs j JOIN instruments i ON i.id = j.instrument_id
     WHERE j.last_run_id = $1 ORDER BY j.status, i.name`,
    [runId]
  );
  return { run, jobs };
}

/** Reencola un job puntual, sin esperar la corrida siguiente. */
export async function retryJob(jobId) {
  const { rows } = await query(
    `UPDATE price_fetch_jobs
     SET status = 'pending', attempts = 0, next_retry_at = NULL,
         locked_at = NULL, last_error = NULL, updated_at = NOW()
     WHERE id = $1 RETURNING id, instrument_id, date, status`,
    [jobId]
  );
  return rows[0] ?? null;
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
