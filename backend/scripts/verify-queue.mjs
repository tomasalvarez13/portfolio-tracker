// Verificación de la cola de precios y el calendario (§2a del plan).
//
// Las fuentes externas se reemplazan por stubs: lo que se prueba es la máquina
// de estados de la cola, el calendario, el backoff, el lock y el relleno de
// huecos — no que Yahoo o la CMF respondan.
//
// ESCRIBE DATOS. Solo corre contra una base local:
//   DATABASE_URL="postgres://postgres:dry@localhost:55432/dryrun" \
//   SUPABASE_URL=http://localhost:54321 SUPABASE_ANON_KEY=x \
//   SUPABASE_SERVICE_ROLE_KEY=x npm run verify:queue

const DB = process.env.DATABASE_URL || '';
if (!/localhost|127\.0\.0\.1/.test(DB)) {
  console.error('Este script escribe datos: solo corre contra una DATABASE_URL local.');
  console.error(`DATABASE_URL actual: ${DB || '(vacía)'}`);
  process.exit(1);
}

const { query, pool } = await import('../src/config/db.js');
const dates = await import('../src/utils/dates.js');
const cal   = await import('../src/services/marketCalendar.js');

// Sufijo por corrida: este script crea un instrumento descartable, y si muere
// antes de limpiarlo la corrida siguiente chocaría con el índice único.
const RUN = String(process.hrtime.bigint()).slice(-9);
const ROTO_EXT = `NOPE-${RUN}`;
let fails = 0;
const check = (n, got, want) => { const ok = String(got)===String(want); if(!ok) fails++; console.log(`${ok?'  ok  ':' FALLA'} ${n}: got=${got} want=${want}`); };

try {
  console.log('\n— helpers de fecha en hora de Chile');
  check('todayCL tiene forma ISO', /^\d{4}-\d{2}-\d{2}$/.test(dates.todayCL()), true);
  check('addDays cruza fin de mes', dates.addDays('2026-01-31', 1), '2026-02-01');
  check('addDays hacia atrás cruza año', dates.addDays('2026-01-01', -1), '2025-12-31');
  check('addDays sobre el cambio de hora CL', dates.addDays('2026-09-05', 1), '2026-09-06');
  check('sábado es fin de semana', dates.isWeekend('2026-08-29'), true);
  check('lunes no es fin de semana', dates.isWeekend('2026-08-31'), false);

  console.log('\n— calendario de mercado');
  check('crypto opera domingo', await cal.isTradingDay('CRYPTO', '2026-08-30'), true);
  check('CL no opera domingo',  await cal.isTradingDay('CL', '2026-08-30'), false);
  check('CL no opera el 18-sep', await cal.isTradingDay('CL', '2026-09-18'), false);
  check('CL opera un martes normal', await cal.isTradingDay('CL', '2026-08-25'), true);
  check('US no opera el 25-dic', await cal.isTradingDay('US', '2026-12-25'), false);
  check('rezago de fondo mutuo', cal.expectedLagDays('fondo_mutuo_cl'), 2);
  check('rezago de acción', cal.expectedLagDays('stock_us'), 0);
  check('mercado de un fondo CL', cal.marketOf('fondo_mutuo_cl'), 'CL');
  check('mercado de crypto', cal.marketOf('crypto'), 'CRYPTO');

  console.log('\n— lastExpectedDate descuenta rezago y salta días no hábiles');
  // Lunes 2026-08-31: una acción espera el cierre del viernes 28 si el lunes no
  // cerró todavía; un fondo con 2 días hábiles de rezago espera el jueves 27.
  check('acción el lunes espera el mismo lunes', await cal.lastExpectedDate('stock_us', '2026-08-31'), '2026-08-31');
  check('fondo el lunes espera 2 hábiles atrás', await cal.lastExpectedDate('fondo_mutuo_cl', '2026-08-31'), '2026-08-27');
  check('acción el domingo retrocede al viernes', await cal.lastExpectedDate('stock_us', '2026-08-30'), '2026-08-28');
  check('acción el 21-may (feriado CL) no aplica a US', await cal.lastExpectedDate('stock_us', '2026-05-21'), '2026-05-21');
  check('fondo CL el 22-may salta el feriado', await cal.lastExpectedDate('fondo_mutuo_cl', '2026-05-22'), '2026-05-19');

  console.log('\n— la cola: encolar, procesar, reintentar');
  const q = await import('../src/services/priceQueue.js');

  await query('DELETE FROM price_fetch_jobs');
  const enq = await q.enqueue({ date: dates.todayCL(), lookbackDays: 5 });
  check('encoló algo', enq.created > 0, true);
  check('no encoló instrumentos manual', (await query(
    `SELECT count(*) c FROM price_fetch_jobs j JOIN instruments i ON i.id=j.instrument_id
     WHERE i.api_source='manual'`)).rows[0].c, 0);
  check('reporta pendientes', enq.pending > 0, true);

  console.log('\n— claim no entrega el mismo job dos veces');
  const antes = (await query(`SELECT count(*) c FROM price_fetch_jobs WHERE status='pending'`)).rows[0].c;
  await query(`UPDATE price_fetch_jobs SET status='running', locked_at=NOW() WHERE id IN
               (SELECT id FROM price_fetch_jobs WHERE status='pending' LIMIT 3)`);
  const pend2 = (await query(`SELECT count(*) c FROM price_fetch_jobs WHERE status='pending'`)).rows[0].c;
  check('3 pasaron a running', Number(antes) - Number(pend2), 3);

  console.log('\n— los jobs colgados se recuperan');
  await query(`UPDATE price_fetch_jobs SET locked_at = NOW() - INTERVAL '20 minutes' WHERE status='running'`);
  const enq2 = await q.enqueue({ date: dates.todayCL(), lookbackDays: 5 });
  check('recuperó los colgados', enq2.recuperados, 3);

  console.log('\n— el advisory lock impide dos workers a la vez');
  let dentro = 0, simultaneos = 0;
  const tarea = () => q.withPriceLock(async () => {
    dentro++; if (dentro > 1) simultaneos++;
    await new Promise((r) => setTimeout(r, 120));
    dentro--;
    return 'ok';
  });
  const [r1, r2] = await Promise.all([tarea(), tarea()]);
  check('nunca hubo dos adentro', simultaneos, 0);
  check('uno de los dos fue rechazado', [r1, r2].filter((x) => x === null).length, 1);

  console.log('\n— máquina de estados: no_data vs failed');
  // Sin red: 'manual' hace que fetchRange lance NoDataError, y 'alpha_vantage'
  // está permitido por el CHECK pero no tiene case en el switch, así que lanza
  // un Error común. Eso separa los dos caminos sin tocar internet.
  await query('DELETE FROM price_fetch_jobs');
  const manualId = (await query(`SELECT id FROM instruments WHERE api_source='manual' LIMIT 1`)).rows[0].id;
  const rotoId = (await query(
    `INSERT INTO instruments (name, type, currency, api_source, external_id, status)
     VALUES ($1, 'stock_us','USD','alpha_vantage',$2,'active')
     RETURNING id`, [`Fuente inexistente ${RUN}`, ROTO_EXT])).rows[0].id;
  // Precio previo, para poder comprobar el carry-forward.
  await query(`INSERT INTO prices (instrument_id, date, price_clp, price_usd, source)
               VALUES ($1, $2, 1000, 1, 'test') ON CONFLICT DO NOTHING`,
              [rotoId, dates.addDays(dates.todayCL(), -3)]);

  const hoy = dates.todayCL();
  await query(`INSERT INTO price_fetch_jobs (instrument_id, date) VALUES ($1,$2),($3,$2)`,
              [manualId, hoy, rotoId]);

  const b1 = await q.runBatch({ limit: 10 });
  check('procesó los dos', b1.tomados, 2);
  check('uno sin dato', b1.no_data, 1);
  check('uno fallido', b1.failed, 1);

  const jm = (await query(`SELECT status FROM price_fetch_jobs WHERE instrument_id=$1 AND date=$2`, [manualId, hoy])).rows[0];
  check('el manual quedó no_data', jm.status, 'no_data');
  const jr = (await query(`SELECT status, attempts, next_retry_at FROM price_fetch_jobs WHERE instrument_id=$1 AND date=$2`, [rotoId, hoy])).rows[0];
  check('el roto quedó failed', jr.status, 'failed');
  check('contó el intento', jr.attempts, 1);
  check('programó el reintento', jr.next_retry_at !== null, true);
  check('carry-forward le puso precio al día', (await query(
    `SELECT count(*) c FROM prices WHERE instrument_id=$1 AND date=$2 AND is_stale`, [rotoId, hoy])).rows[0].c, 1);

  console.log('\n— el backoff impide reintentar de inmediato');
  const b2 = await q.runBatch({ limit: 10 });
  check('no volvió a tomarlo', b2.tomados, 0);

  console.log('\n— tras agotar los intentos deja de reintentar');
  await query(`UPDATE price_fetch_jobs SET attempts=3, next_retry_at=NOW() - INTERVAL '1 hour'
               WHERE instrument_id=$1 AND date=$2`, [rotoId, hoy]);
  const b3 = await q.runBatch({ limit: 10 });
  check('lo tomó una última vez', b3.tomados, 1);
  const jr2 = (await query(`SELECT attempts, next_retry_at FROM price_fetch_jobs WHERE instrument_id=$1 AND date=$2`, [rotoId, hoy])).rows[0];
  check('llegó al máximo', jr2.attempts, 4);
  check('ya no programa reintento', jr2.next_retry_at, null);
  const b4 = await q.runBatch({ limit: 10 });
  check('no lo vuelve a tomar', b4.tomados, 0);
  check('aparece como agotado', (await q.queueStatus(hoy)).agotados.length >= 1, true);

  console.log('\n— un no_data se reabre si el hueco sigue ahí');
  // No hace falta cambiarle la fuente: enqueue solo excluye 'manual', así que
  // alpha_vantage sigue siendo encolable. (Y reasignarlo a cmf/9570 chocaría con
  // el índice único del maestro, que es justamente lo que tiene que hacer.)
  await query(`UPDATE price_fetch_jobs SET status='no_data', attempts=1, next_retry_at=NULL
               WHERE instrument_id=$1 AND date=$2`, [rotoId, hoy]);
  const enq3 = await q.enqueue({ date: hoy, lookbackDays: 3 });
  const reabierto = (await query(
    `SELECT status FROM price_fetch_jobs WHERE instrument_id=$1 AND date=$2`, [rotoId, hoy])).rows[0];
  check('volvió a pending', reabierto.status, 'pending');

  console.log('\n— un done NO se reabre');
  await query(`UPDATE price_fetch_jobs SET status='done' WHERE instrument_id=$1 AND date=$2`, [rotoId, hoy]);
  await q.enqueue({ date: hoy, lookbackDays: 3 });
  check('sigue en done', (await query(
    `SELECT status FROM price_fetch_jobs WHERE instrument_id=$1 AND date=$2`, [rotoId, hoy])).rows[0].status, 'done');

  console.log('\n— el estado de la cola se puede consultar');
  const st = await q.queueStatus(dates.todayCL());
  check('devuelve por_estado', typeof st.por_estado, 'object');
  check('devuelve agotados', Array.isArray(st.agotados), true);

  console.log('\n— el lote se toma por instrumento, no por job suelto');
  // Las fuentes se consultan por rango, así que la unidad del lote es el
  // instrumento: un request cubre todas sus fechas. Antes se tomaban jobs
  // sueltos ordenados por id y un lote terminaba siendo un solo instrumento
  // repetido, una llamada por fecha a la misma fuente.
  await query('DELETE FROM price_fetch_jobs');
  const rotoB = (await query(
    `INSERT INTO instruments (name, type, currency, api_source, external_id, status)
     VALUES ($1, 'stock_us','USD','alpha_vantage',$2,'active')
     RETURNING id`, [`Fuente inexistente B ${RUN}`, `NOPE-B-${RUN}`])).rows[0].id;
  for (const id of [rotoId, rotoB]) {
    for (let k = 1; k <= 5; k++) {
      await query(`INSERT INTO price_fetch_jobs (instrument_id, date) VALUES ($1,$2)
                   ON CONFLICT (instrument_id, date) DO UPDATE SET status='pending', attempts=0`,
                  [id, dates.addDays(hoy, -k)]);
    }
  }
  const g1 = await q.runBatch({ limit: 1 });
  check('limit=1 toma un instrumento', g1.instrumentos, 1);
  check('y con él todas sus fechas', g1.tomados, 5);
  check('un fallo de fuente cae sobre todos sus jobs', g1.failed, 5);

  const g2 = await q.runBatch({ limit: 10 });
  check('el segundo lote toma el otro instrumento', g2.instrumentos, 1);
  check('con sus cinco fechas', g2.tomados, 5);

  console.log('\n— un precio real cierra el hueco; el carry-forward no');
  // Es la razón de fondo del cambio: price_gaps solo descarta un día si hay
  // precio con is_stale=FALSE, así que una fecha tapada con carry-forward se
  // vuelve a listar para siempre y su job se reabre en cada corrida.
  const { upsertPrice, carryForward, resolverDolar } = await import('../src/services/priceService.js');
  const hueco = dates.addDays(hoy, -1);
  await query('DELETE FROM prices WHERE instrument_id=$1', [rotoB]);
  await query(`INSERT INTO prices (instrument_id, date, price_clp, price_usd, source)
               VALUES ($1,$2,500,1,'test')`, [rotoB, dates.addDays(hoy, -6)]);

  await carryForward(rotoB, hueco);
  const conStale = await cal.gapsFor(rotoB, 'stock_us', hoy, 5);
  check('el carry-forward NO cierra el hueco', conStale.includes(hueco), true);

  await upsertPrice({ instrumentId: rotoB, date: hueco, priceClp: 777, priceUsd: null, source: 'test', usdClp: 900 });
  const conReal = await cal.gapsFor(rotoB, 'stock_us', hoy, 5);
  check('el precio real SÍ lo cierra', conReal.includes(hueco), false);
  check('y pisó la fila stale', (await query(
    `SELECT is_stale FROM prices WHERE instrument_id=$1 AND date=$2`, [rotoB, hueco])).rows[0].is_stale, false);

  console.log('\n— el tipo de cambio es el de la fecha, no el de hoy');
  // Llenar ventanas completas escribe muchos días pasados: convertirlos todos al
  // dólar de hoy los deja mal por lo que se haya movido el tipo de cambio.
  // Fechas viejas a propósito: la serie de mindicador cubre el año en curso, así
  // que en 2019 el resolutor solo puede usar lo que hay en la base. Sin eso el
  // dato real del día tapa el caso que se quiere probar.
  const d1 = '2019-03-01', d2 = '2019-03-05';
  await query(`INSERT INTO exchange_rates (date, usd_clp) VALUES ($1,800),($2,900)
               ON CONFLICT (date) DO UPDATE SET usd_clp=EXCLUDED.usd_clp`, [d1, d2]);
  const usdEn = await resolverDolar(d1, d2);
  check('usa el dólar exacto de la fecha', usdEn(d1), 800);
  check('y el de la otra fecha', usdEn(d2), 900);
  check('un día sin dato toma el anterior', usdEn('2019-03-02'), 800);
  check('antes del primer dato cae al último conocido', usdEn('2019-02-01') !== 800, true);

  console.log('\n— is_stale se propaga al snapshot');
  const { writeSnapshots } = await import('../src/services/portfolioService.js');
  const inst = (await query(`SELECT instrument_id FROM positions LIMIT 1`)).rows[0].instrument_id;
  await query(`UPDATE prices SET is_stale = TRUE WHERE instrument_id=$1 AND date=(
                 SELECT max(date) FROM prices WHERE instrument_id=$1)`, [inst]);
  await writeSnapshots(dates.todayCL());
  check('la posición quedó marcada stale', (await query(
    `SELECT count(*) c FROM position_snapshots WHERE date=$1 AND instrument_id=$2 AND is_stale`,
    [dates.todayCL(), inst])).rows[0].c, 1);
  check('el portafolio cuenta las stale', Number((await query(
    `SELECT max(stale_positions) m FROM portfolio_snapshots WHERE date=$1`,
    [dates.todayCL()])).rows[0].m) >= 1, true);

  console.log(fails===0 ? '\n=== TODO OK ===' : `\n=== ${fails} FALLA(S) ===`);
} catch (e) {
  console.error('\nERROR:', e.message, '\n', e.stack?.split('\n').slice(0,5).join('\n')); fails++;
} finally {
  // En el finally, no inline: si una aserción explota, el instrumento
  // descartable igual se va y la corrida siguiente arranca limpia.
  try {
    await query('DELETE FROM instruments WHERE api_source=$1 AND external_id LIKE $2',
                ['alpha_vantage', 'NOPE-%']);
    await query(`DELETE FROM exchange_rates WHERE date BETWEEN '2019-01-01' AND '2019-12-31'`);
  } catch (e) { console.error('(limpieza falló:', e.message, ')'); }
  await pool.end();
  process.exit(fails===0?0:1);
}
