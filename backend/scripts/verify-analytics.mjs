// Verificación de la rentabilidad por custodio y por activo (Fase 3).
//
// ESCRIBE DATOS. Solo corre contra una base local.

const DB = process.env.DATABASE_URL || '';
if (!/localhost|127\.0\.0\.1/.test(DB)) {
  console.error('Este script escribe datos: solo corre contra una DATABASE_URL local.');
  console.error(`DATABASE_URL actual: ${DB || '(vacía)'}`);
  process.exit(1);
}

const { query, pool } = await import('../src/config/db.js');
const { computeTWRFromSeries, byCustodian, byInstrument, availableRange } =
  await import('../src/services/analyticsService.js');
const { addDays } = await import('../src/utils/dates.js');

const U = '11111111-1111-1111-1111-111111111111';
const RUN = String(process.hrtime.bigint()).slice(-9);
let fails = 0;
const check = (n, got, want) => { const ok = String(got)===String(want); if(!ok) fails++; console.log(`${ok?'  ok  ':' FALLA'} ${n}: got=${got} want=${want}`); };
const r2 = (n) => n == null ? null : Math.round(Number(n) * 100) / 100;

try {
  console.log('\n— computeTWRFromSeries: la función pura');
  check('sin flujos, sube 10%', r2(computeTWRFromSeries([
    { date: '2026-01-01', value: 100, flow: 0 },
    { date: '2026-01-02', value: 110, flow: 0 },
  ]).twr_pct), 10);

  check('dos períodos componen geométricamente', r2(computeTWRFromSeries([
    { date: '2026-01-01', value: 100, flow: 0 },
    { date: '2026-01-02', value: 110, flow: 0 },
    { date: '2026-01-03', value: 121, flow: 0 },
  ]).twr_pct), 21);

  check('un aporte NO cuenta como rentabilidad', r2(computeTWRFromSeries([
    { date: '2026-01-01', value: 100, flow: 0 },
    { date: '2026-01-02', value: 210, flow: 100 },
  ]).twr_pct), 10);

  check('un retiro tampoco', r2(computeTWRFromSeries([
    { date: '2026-01-01', value: 100, flow: 0 },
    { date: '2026-01-02', value: 60, flow: -50 },
  ]).twr_pct), 10);

  check('aporte puro sin movimiento de precio da 0%', r2(computeTWRFromSeries([
    { date: '2026-01-01', value: 100, flow: 0 },
    { date: '2026-01-02', value: 200, flow: 100 },
  ]).twr_pct), 0);

  check('una caída da negativo', r2(computeTWRFromSeries([
    { date: '2026-01-01', value: 100, flow: 0 },
    { date: '2026-01-02', value: 80,  flow: 0 },
  ]).twr_pct), -20);

  const desdeCero = computeTWRFromSeries([
    { date: '2026-01-01', value: 0,   flow: 0 },
    { date: '2026-01-02', value: 100, flow: 100 },
    { date: '2026-01-03', value: 110, flow: 0 },
  ]);
  check('el día que nace la posición se saltea', desdeCero.sub_periodos_saltados, 1);
  check('y el resto sí cuenta', r2(desdeCero.twr_pct), 10);

  check('un solo punto no alcanza', computeTWRFromSeries([{ date: 'x', value: 1, flow: 0 }]).twr_pct, null);
  check('serie vacía no revienta', computeTWRFromSeries([]).twr_pct, null);

  console.log('\n— los flujos se derivan de las unidades, no de movements');
  // Escenario controlado: un activo en un custodio, tres días.
  //   d1: 10 unidades a 100  -> valor 1000
  //   d2: 10 unidades a 110  -> valor 1100   (solo precio: +10%)
  //   d3: 20 unidades a 110  -> valor 2200   (aporte de 10 uds = 1100, 0% de rent.)
  const cust = (await query(
    `INSERT INTO custodians (slug, name) VALUES ($1,$2) RETURNING id`,
    [`an-${RUN}`, `Analytics ${RUN}`])).rows[0].id;
  const inst = (await query(
    `INSERT INTO instruments (name, type, currency, api_source, status)
     VALUES ($1,'stock_us','CLP','manual','active') RETURNING id`,
    [`Analytics activo ${RUN}`])).rows[0].id;

  const d3 = '2026-06-03', d2 = '2026-06-02', d1 = '2026-06-01';
  const ins = (date, units, price, value) => query(
    `INSERT INTO position_snapshots (user_id, date, custodian_id, instrument_id, units, price_clp, value_clp, value_usd)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (user_id,date,custodian_id,instrument_id) DO UPDATE
       SET units=EXCLUDED.units, price_clp=EXCLUDED.price_clp, value_clp=EXCLUDED.value_clp`,
    [U, date, cust, inst, units, price, value, value / 950]);
  await ins(d1, 10, 100, 1000);
  await ins(d2, 10, 110, 1100);
  await ins(d3, 20, 110, 2200);

  const porAct = await byInstrument(U, d1, d3);
  const b = porAct.buckets.find((x) => x.key === `i${inst}`);
  check('encontró el activo', !!b, true);
  check('valor inicial', r2(b.valor_inicial_clp), 1000);
  check('valor final', r2(b.valor_final_clp), 2200);
  check('el aporte se derivó de las unidades', r2(b.aportes_clp), 1100);
  check('sin retiros', r2(b.retiros_clp), 0);
  check('el TWR ignora el aporte: solo el +10% de precio', r2(b.twr_pct), 10);
  check('los flujos son estimables', b.flujos_estimados, true);

  console.log('\n— una venta parcial también se deriva');
  await ins(d3, 5, 110, 550);
  const porAct2 = await byInstrument(U, d1, d3);
  const b2 = porAct2.buckets.find((x) => x.key === `i${inst}`);
  check('el retiro se derivó', r2(b2.retiros_clp), 550);
  check('el TWR sigue siendo el +10% de precio', r2(b2.twr_pct), 10);

  console.log('\n— una posición por MONTO no permite estimar flujos');
  const inst2 = (await query(
    `INSERT INTO instruments (name, type, currency, api_source, status)
     VALUES ($1,'fondo_mutuo_cl','CLP','manual','active') RETURNING id`,
    [`Analytics monto ${RUN}`])).rows[0].id;
  for (const [d, v] of [[d1, 500], [d2, 600], [d3, 700]]) {
    await query(
      `INSERT INTO position_snapshots (user_id, date, custodian_id, instrument_id, units, price_clp, value_clp, value_usd)
       VALUES ($1,$2,$3,$4,NULL,NULL,$5,$6)
       ON CONFLICT (user_id,date,custodian_id,instrument_id) DO UPDATE SET value_clp=EXCLUDED.value_clp`,
      [U, d, cust, inst2, v, v / 950]);
  }
  const porAct3 = await byInstrument(U, d1, d3);
  const bm = porAct3.buckets.find((x) => x.key === `i${inst2}`);
  check('marca que no puede estimar', bm.flujos_estimados, false);
  check('devuelve twr null en vez de inventar', bm.twr_pct, null);
  check('pero igual reporta los valores', r2(bm.valor_final_clp), 700);

  console.log('\n— por custodio suma los activos del mismo custodio');
  const porCust = await byCustodian(U, d1, d3);
  const bc = porCust.buckets.find((x) => x.key === `c${cust}`);
  check('el valor final es la suma', r2(bc.valor_final_clp), 550 + 700);
  check('el valor inicial también', r2(bc.valor_inicial_clp), 1000 + 500);
  check('un activo sin unidades contagia el flag', bc.flujos_estimados, false);
  check('el label es el nombre del custodio', bc.label, `Analytics ${RUN}`);

  console.log('\n— el rango disponible sale de position_snapshots');
  const rango = await availableRange(U);
  check('reporta una fecha inicial', /^\d{4}-\d{2}-\d{2}$/.test(rango.desde || ''), true);
  check('cuenta los días', rango.dias > 0, true);

  console.log('\n— computeTWR del portafolio sigue funcionando tras el refactor');
  const { computeTWR } = await import('../src/services/portfolioService.js');
  const twrPort = await computeTWR(U, addDays(rango.hasta, -400), rango.hasta);
  check('devuelve un número o un error explícito',
        twrPort.twr_pct != null || !!twrPort.error, true);

  console.log(fails===0 ? '\n=== TODO OK ===' : `\n=== ${fails} FALLA(S) ===`);
} catch (e) {
  console.error('\nERROR:', e.message, '\n', e.stack?.split('\n').slice(0,5).join('\n')); fails++;
} finally {
  try {
    await query(`DELETE FROM position_snapshots WHERE instrument_id IN (SELECT id FROM instruments WHERE name LIKE 'Analytics %')`);
    await query(`DELETE FROM instruments WHERE name LIKE 'Analytics %'`);
    await query(`DELETE FROM custodians  WHERE slug LIKE 'an-%'`);
  } catch (e) { console.error('(limpieza falló:', e.message, ')'); }
  await pool.end();
  process.exit(fails===0?0:1);
}
