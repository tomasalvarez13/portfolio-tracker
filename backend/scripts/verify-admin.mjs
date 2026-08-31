// Verificación del mantenedor admin (§3.4 del plan).
//
// Cubre: el cierre de la escritura de instrumentos, el registro de ejecuciones
// del cron, y la fusión de custodios.
//
// ESCRIBE DATOS. Solo corre contra una base local.

const DB = process.env.DATABASE_URL || '';
if (!/localhost|127\.0\.0\.1/.test(DB)) {
  console.error('Este script escribe datos: solo corre contra una DATABASE_URL local.');
  console.error(`DATABASE_URL actual: ${DB || '(vacía)'}`);
  process.exit(1);
}

const { query, pool } = await import('../src/config/db.js');
const q  = await import('../src/services/priceQueue.js');
const { todayCL } = await import('../src/utils/dates.js');
const { setBalance } = await import('../src/services/ledgerService.js');

const U = '11111111-1111-1111-1111-111111111111';
const RUN = String(process.hrtime.bigint()).slice(-9);
let fails = 0;
const check = (n, got, want) => { const ok = String(got)===String(want); if(!ok) fails++; console.log(`${ok?'  ok  ':' FALLA'} ${n}: got=${got} want=${want}`); };

try {
  console.log('\n— las ejecuciones del cron quedan registradas');
  await query('DELETE FROM job_runs');
  await query('DELETE FROM price_fetch_jobs');
  const enq = await q.enqueue({ date: todayCL(), lookbackDays: 3, trigger: 'cron' });
  check('el enqueue devolvió un run_id', typeof enq.run_id === 'string' || typeof enq.run_id === 'number', true);
  const r1 = (await query('SELECT * FROM job_runs WHERE id=$1', [enq.run_id])).rows[0];
  check('quedó la fila de la corrida', r1.kind, 'enqueue');
  check('guardó quién la disparó', r1.trigger, 'cron');
  check('guardó cuántos encoló', r1.enqueued, enq.created);
  check('quedó cerrada', r1.finished_at !== null, true);

  const bat = await q.runBatch({ limit: 5, trigger: 'cron' });
  const r2 = (await query('SELECT * FROM job_runs WHERE id=$1', [bat.run_id])).rows[0];
  check('la corrida de run quedó', r2.kind, 'run');
  check('guardó los tomados', r2.claimed, bat.tomados);
  check('suma ok+no_data+failed = tomados', Number(r2.ok)+Number(r2.no_data)+Number(r2.failed), bat.tomados);

  console.log('\n— se puede abrir una corrida y ver sus jobs');
  const det = await q.getRun(bat.run_id);
  check('devuelve la corrida', det.run.id, bat.run_id);
  check('los jobs quedaron ligados a ella', det.jobs.length, bat.tomados);
  check('cada job trae el instrumento', det.jobs.every((j) => !!j.instrumento), true);

  console.log('\n— listRuns ordena por más reciente');
  const runs = await q.listRuns(10);
  check('lista las dos', runs.length >= 2, true);
  check('la más nueva primero', runs[0].id, bat.run_id);
  check('calcula la duración', typeof runs[0].duracion_s, 'number');

  console.log('\n— retryJob reencola sin esperar');
  const jid = (await query(`SELECT id FROM price_fetch_jobs LIMIT 1`)).rows[0].id;
  await query(`UPDATE price_fetch_jobs SET status='failed', attempts=4, last_error='x',
               next_retry_at=NULL WHERE id=$1`, [jid]);
  const re = await q.retryJob(jid);
  check('volvió a pending', re.status, 'pending');
  const j2 = (await query('SELECT attempts, last_error FROM price_fetch_jobs WHERE id=$1', [jid])).rows[0];
  check('reseteó los intentos', j2.attempts, 0);
  check('limpió el error', j2.last_error, null);
  check('retryJob de un id inexistente devuelve null', await q.retryJob(99999999), null);

  console.log('\n— merge_custodians fusiona sin perder plata');
  const mk = async (slug, nombre) => (await query(
    `INSERT INTO custodians (slug, name) VALUES ($1,$2) RETURNING id`, [slug, nombre])).rows[0].id;
  const cA = await mk(`merge-a-${RUN}`, `Merge A ${RUN}`);
  const cB = await mk(`merge-b-${RUN}`, `Merge B ${RUN}`);
  const i1 = (await query(`SELECT id FROM instruments WHERE ticker='SPY'`)).rows[0].id;
  const i2 = (await query(`SELECT id FROM instruments WHERE ticker='MSFT'`)).rows[0].id;
  const hoy = todayCL();
  // El mismo activo en los dos custodios (los saldos tienen que sumarse) y uno
  // solo en el origen (solo se repunta).
  await setBalance({ userId: U, custodianId: cA, instrumentId: i1, date: hoy, units: 10, supersede: true });
  await setBalance({ userId: U, custodianId: cB, instrumentId: i1, date: hoy, units: 25, supersede: true });
  await setBalance({ userId: U, custodianId: cA, instrumentId: i2, date: hoy, units: 7,  supersede: true });

  const suma = async () => Number((await query(
    `SELECT COALESCE(SUM(units),0) s FROM positions WHERE user_id=$1 AND custodian_id IN ($2,$3)`,
    [U, cA, cB])).rows[0].s);
  check('estado inicial', await suma(), 42);

  const m = (await query('SELECT * FROM merge_custodians($1,$2)', [cA, cB])).rows[0];
  check('unidades totales se conservan', await suma(), 42);
  check('el saldo compartido se sumó', Number((await query(
    `SELECT units FROM positions WHERE user_id=$1 AND custodian_id=$2 AND instrument_id=$3`,
    [U, cB, i1])).rows[0].units), 35);
  check('el activo que solo estaba en A se movió', Number((await query(
    `SELECT units FROM positions WHERE user_id=$1 AND custodian_id=$2 AND instrument_id=$3`,
    [U, cB, i2])).rows[0].units), 7);
  check('el origen quedó sin posiciones', (await query(
    'SELECT count(*) c FROM positions WHERE custodian_id=$1', [cA])).rows[0].c, 0);
  check('el origen apunta al canónico', (await query(
    'SELECT canonical_id FROM custodians WHERE id=$1', [cA])).rows[0].canonical_id, cB);
  check('reporta saldos sumados', m.saldos_sumados > 0, true);
  check('el origen ya no aparece en la lista de custodios activos', (await query(
    'SELECT count(*) c FROM custodians WHERE id=$1 AND canonical_id IS NULL', [cA])).rows[0].c, 0);

  console.log('\n— el centinela no se puede fusionar');
  let bloqueo = false;
  try { await query('SELECT * FROM merge_custodians(0, $1)', [cB]); } catch { bloqueo = true; }
  check('rechaza fusionar "sin custodio"', bloqueo, true);
  let bloqueo2 = false;
  try { await query('SELECT * FROM merge_custodians($1,$1)', [cB]); } catch { bloqueo2 = true; }
  check('rechaza fusionar consigo mismo', bloqueo2, true);

  console.log(fails===0 ? '\n=== TODO OK ===' : `\n=== ${fails} FALLA(S) ===`);
} catch (e) {
  console.error('\nERROR:', e.message, '\n', e.stack?.split('\n').slice(0,5).join('\n')); fails++;
} finally {
  try {
    await query(`DELETE FROM transactions WHERE custodian_id IN (SELECT id FROM custodians WHERE slug LIKE 'merge-%')`);
    await query(`DELETE FROM positions    WHERE custodian_id IN (SELECT id FROM custodians WHERE slug LIKE 'merge-%')`);
    await query(`DELETE FROM position_snapshots WHERE custodian_id IN (SELECT id FROM custodians WHERE slug LIKE 'merge-%')`);
    await query(`UPDATE custodians SET canonical_id = NULL WHERE slug LIKE 'merge-%'`);
    await query(`DELETE FROM custodians WHERE slug LIKE 'merge-%'`);
  } catch (e) { console.error('(limpieza falló:', e.message, ')'); }
  await pool.end();
  process.exit(fails===0?0:1);
}
