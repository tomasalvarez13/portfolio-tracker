// Verificación de los snapshots set-based (§3.3 del plan).
//
// Compara la valorización en SQL contra la de computePositions() en JS —la
// lógica que reemplaza— y chequea idempotencia, limpieza de huérfanas, scope
// por usuario y el cero explícito de quien se queda sin posiciones.
//
// ESCRIBE DATOS. Por eso solo corre contra una base local:
//   docker run -d --name pt-dryrun -e POSTGRES_PASSWORD=dry -e POSTGRES_DB=dryrun \
//     -p 55432:5432 postgres:16-alpine
//   (aplicar schema.sql + invitations.sql + seed.sql + migraciones 002 y 003)
//
//   DATABASE_URL="postgres://postgres:dry@localhost:55432/dryrun" \
//   SUPABASE_URL=http://localhost:54321 SUPABASE_ANON_KEY=x \
//   SUPABASE_SERVICE_ROLE_KEY=x npm run verify:snapshots

const DB = process.env.DATABASE_URL || '';
if (!/localhost|127\.0\.0\.1/.test(DB)) {
  console.error('Este script escribe datos: solo corre contra una DATABASE_URL local.');
  console.error(`DATABASE_URL actual: ${DB || '(vacía)'}`);
  process.exit(1);
}

// Imports dinámicos a propósito: config/db.js abre el pool al evaluarse, así que
// la guardia de arriba tiene que correr primero.
const { query, pool } = await import('../src/config/db.js');
const { computePositions, writeSnapshots, computeAndSaveSnapshot, snapshotAllUsers } =
  await import('../src/services/portfolioService.js');
const { closePosition, setBalance } = await import('../src/services/ledgerService.js');

const U = '11111111-1111-1111-1111-111111111111';
const today = new Date().toISOString().slice(0, 10);
// Sufijo por corrida: este script crea un instrumento descartable y si muere
// antes de limpiarlo, la corrida siguiente chocaría con el índice único.
const RUN = String(process.hrtime.bigint()).slice(-9);
let fails = 0;
const check = (name, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) fails++;
  console.log(`${ok ? '  ok  ' : ' FALLA'} ${name}: got=${got} want=${want}`);
};
const r2 = (n) => Math.round(Number(n) * 100) / 100;
// Comparar plata al centavo entre dos sumatorias independientes es frágil: el
// SQL suma valores guardados a 6 decimales y el JS suma doubles, y cuando el
// total cae justo en un .xx5 la diferencia de ~1e-6 alcanza para que redondeen
// a lados distintos. Lo que hay que exigir es que coincidan DENTRO de un
// centavo, no que sean idénticos después de redondear.
const cerca = (a, b, tol = 0.01) => Math.abs(Number(a) - Number(b)) <= tol;

try {
  // Fixture propio: este script cierra posiciones y deja al usuario en cero, así
  // que no puede depender del estado inicial. Lo reconstruye siempre.
  console.log('— preparando fixture');
  const inst = async (t) => (await query(
    'SELECT id FROM instruments WHERE ticker=$1 OR name=$1', [t])).rows[0].id;
  const cust = async (sl) => (await query(
    'SELECT id FROM custodians WHERE slug=$1', [sl])).rows[0].id;
  const fixture = [
    { i: await inst('AMZN'), c: await cust('fintual'),  units: 100.5 },
    { i: await inst('SPY'),  c: await cust('banchile'), units: 33.75 },
    { i: await inst('MSFT'), c: await cust('ibkr'),     amountUsd: 4200.5 },
    { i: await inst('FM Fintual Risky Norris'), c: 0,   units: 2345.678 },
  ];
  for (const f of fixture) {
    await setBalance({ userId: U, custodianId: f.c, instrumentId: f.i, date: today,
      units: f.units ?? null, amountUsd: f.amountUsd ?? null, supersede: true });
  }
  // Las del fixture, no el total del usuario: puede tener otras de otro script.
  check('posiciones del fixture', (await query(
    `SELECT count(*) c FROM positions
     WHERE user_id = $1 AND (custodian_id, instrument_id) IN
       (${fixture.map((_, k) => `($${k * 2 + 2}, $${k * 2 + 3})`).join(', ')})`,
    [U, ...fixture.flatMap((f) => [f.c, f.i])])).rows[0].c, fixture.length);

  console.log('\n— el SQL valoriza igual que computePositions (JS)');
  const js = await computePositions(U);
  // Acotado a U: rep.positions de snapshotAllUsers es global y no es comparable
  // contra las posiciones de un solo usuario.
  const rep = await writeSnapshots(today, U);
  check('filas escritas = posiciones', rep.positions, js.positions.length);

  const { rows: sql } = await query(
    `SELECT custodian_id, instrument_id, value_clp, value_usd, units
     FROM position_snapshots WHERE user_id=$1 AND date=$2`, [U, today]);
  const key = (x) => `${x.custodian_id}/${x.instrument_id}`;
  const sqlMap = new Map(sql.map((x) => [key(x), x]));

  let mismatches = 0;
  for (const p of js.positions) {
    const s = sqlMap.get(key(p));
    if (!s) { mismatches++; console.log(`    sin fila SQL para ${key(p)}`); continue; }
    if (!cerca(s.value_clp, p.value_clp) || !cerca(s.value_usd, p.value_usd)) {
      mismatches++;
      console.log(`    ${p.name} @${p.custodian_name}: SQL ${r2(s.value_clp)}/${r2(s.value_usd)} vs JS ${r2(p.value_clp)}/${r2(p.value_usd)}`);
    }
  }
  check('posiciones con valorización distinta', mismatches, 0);

  console.log('\n— portfolio_snapshots cuadra con la suma del detalle');
  const { rows: [tot] } = await query(
    `SELECT total_clp, total_usd, breakdown FROM portfolio_snapshots WHERE user_id=$1 AND date=$2`, [U, today]);
  const { rows: [sum] } = await query(
    `SELECT SUM(value_clp) clp, SUM(value_usd) usd FROM position_snapshots WHERE user_id=$1 AND date=$2`, [U, today]);
  check('total_clp = suma del detalle', cerca(tot.total_clp, sum.clp), true);
  check('total_usd = suma del detalle', cerca(tot.total_usd, sum.usd), true);
  check('total_clp = total de computePositions', cerca(tot.total_clp, js.totalClp), true);
  check('total_usd = total de computePositions', cerca(tot.total_usd, js.totalUsd), true);

  console.log('\n— el breakdown por tipo mantiene el shape de antes');
  const bd = tot.breakdown;
  const jsBd = {};
  for (const p of js.positions) {
    jsBd[p.type] ??= { clp: 0, usd: 0 };
    jsBd[p.type].clp += p.value_clp || 0;
    jsBd[p.type].usd += p.value_usd || 0;
  }
  check('mismos tipos', Object.keys(bd).sort().join(','), Object.keys(jsBd).sort().join(','));
  let bdBad = 0;
  for (const t of Object.keys(jsBd)) {
    if (!cerca(bd[t]?.clp, jsBd[t].clp) || !cerca(bd[t]?.usd, jsBd[t].usd)) {
      bdBad++;
      console.log(`    ${t}: SQL ${r2(bd[t]?.clp)}/${r2(bd[t]?.usd)} vs JS ${r2(jsBd[t].clp)}/${r2(jsBd[t].usd)}`);
    }
  }
  check('tipos con monto distinto', bdBad, 0);

  console.log('\n— idempotente: correrlo dos veces no duplica ni cambia nada');
  const before = JSON.stringify((await query(
    `SELECT custodian_id, instrument_id, value_clp, value_usd FROM position_snapshots
     WHERE user_id=$1 AND date=$2 ORDER BY 1,2`, [U, today])).rows);
  await snapshotAllUsers(today);
  const after = JSON.stringify((await query(
    `SELECT custodian_id, instrument_id, value_clp, value_usd FROM position_snapshots
     WHERE user_id=$1 AND date=$2 ORDER BY 1,2`, [U, today])).rows);
  check('mismo contenido tras la segunda pasada', before === after, true);

  console.log('\n— cerrar una posición limpia su fila del snapshot del día');
  const { rows: [p0] } = await query(
    `SELECT custodian_id, instrument_id FROM positions WHERE user_id=$1 LIMIT 1`, [U]);
  await closePosition({ userId: U, custodianId: p0.custodian_id, instrumentId: p0.instrument_id, date: today });
  await snapshotAllUsers(today);
  const { rows: [huerfana] } = await query(
    `SELECT count(*) c FROM position_snapshots
     WHERE user_id=$1 AND date=$2 AND custodian_id=$3 AND instrument_id=$4`,
    [U, today, p0.custodian_id, p0.instrument_id]);
  check('fila huérfana en el snapshot', huerfana.c, 0);

  const { rows: [t2] } = await query(
    `SELECT total_clp FROM portfolio_snapshots WHERE user_id=$1 AND date=$2`, [U, today]);
  const { rows: [s2] } = await query(
    `SELECT COALESCE(SUM(value_clp),0) clp FROM position_snapshots WHERE user_id=$1 AND date=$2`, [U, today]);
  check('total recalculado cuadra con el detalle', r2(t2.total_clp), r2(s2.clp));

  console.log('\n— acotado a un usuario no toca a los demás');
  await query(`INSERT INTO invitations (email, note) VALUES ('otro@ejemplo.cl','t') ON CONFLICT DO NOTHING`);
  await query(`INSERT INTO auth.users (id, email) VALUES ('22222222-2222-2222-2222-222222222222','otro@ejemplo.cl') ON CONFLICT DO NOTHING`);
  await setBalance({ userId: '22222222-2222-2222-2222-222222222222',
    instrumentId: (await query(`SELECT id FROM instruments WHERE ticker='TSLA'`)).rows[0].id,
    date: today, units: 7 });
  const antesOtro = (await query(
    `SELECT count(*) c FROM position_snapshots WHERE user_id='22222222-2222-2222-2222-222222222222'`)).rows[0].c;
  await writeSnapshots(today, U);
  const despuesOtro = (await query(
    `SELECT count(*) c FROM position_snapshots WHERE user_id='22222222-2222-2222-2222-222222222222'`)).rows[0].c;
  check('el otro usuario quedó intacto', despuesOtro, antesOtro);

  await snapshotAllUsers(today);
  const ambos = (await query(
    `SELECT count(DISTINCT user_id) c FROM position_snapshots WHERE date=$1`, [today])).rows[0].c;
  check('sin scope cubre a los dos usuarios', ambos, 2);

  console.log('\n— quien se queda en cero recibe un cero explícito, no un hueco');
  await query(`DELETE FROM position_snapshots WHERE user_id=$1`, [U]);
  await query(`INSERT INTO portfolio_snapshots (user_id,date,total_clp,total_usd)
               VALUES ($1,$2,999,9) ON CONFLICT (user_id,date) DO NOTHING`, [U, '2026-01-15']);
  const { rows: pos } = await query(`SELECT custodian_id, instrument_id FROM positions WHERE user_id=$1`, [U]);
  for (const q of pos) await closePosition({ userId: U, custodianId: q.custodian_id, instrumentId: q.instrument_id, date: today });
  await snapshotAllUsers(today);
  const { rows: [cero] } = await query(
    `SELECT total_clp FROM portfolio_snapshots WHERE user_id=$1 AND date=$2`, [U, today]);
  check('hay fila con total 0', cero ? r2(cero.total_clp) : 'sin fila', 0);

  console.log('\n— computeAndSaveSnapshot mantiene su shape de retorno');
  // (el usuario 2222… conserva su posición, así que este chequeo no depende del
  //  fixture de U, que la sección anterior dejó en cero a propósito)
  const single = await computeAndSaveSnapshot('22222222-2222-2222-2222-222222222222', today);
  check('devuelve date', single.date, today);
  check('devuelve total_clp numérico', typeof single.total_clp, 'number');
  check('devuelve breakdown objeto', typeof single.breakdown, 'object');

  console.log('\n— un activo SIN precio nunca cae a cero si trae monto');
  // El caso real que apareció en producción: la cartola crea un activo
  // pending_mapping (api_source manual, sin precio jamás) con units Y monto.
  // computePositions entraba por la rama de units, no encontraba precio, y la
  // posición valía CERO en silencio — dos posiciones se perdieron del
  // patrimonio sin que nada fallara.
  const sinPrecio = (await query(
    `INSERT INTO instruments (name, type, currency, api_source, status, created_by)
     VALUES ($1,'stock_us','USD','manual','pending_mapping',$2) RETURNING id`,
    [`Sin precio ${RUN}`, U])).rows[0].id;
  check('de verdad no tiene ningún precio', (await query(
    'SELECT count(*) c FROM prices WHERE instrument_id=$1', [sinPrecio])).rows[0].c, 0);

  await query(
    `INSERT INTO transactions (user_id, custodian_id, instrument_id, date, kind, units, amount_usd, source)
     VALUES ($1, 0, $2, $3, 'saldo', 1.06411967, 335.78, 'cartola')
     ON CONFLICT (user_id, custodian_id, instrument_id, date) WHERE kind='saldo'
     DO UPDATE SET units = EXCLUDED.units, amount_usd = EXCLUDED.amount_usd`,
    [U, sinPrecio, today]);
  await query('SELECT rebuild_position($1, 0, $2)', [U, sinPrecio]);

  const cp2 = await computePositions(U);
  const sinPrecioPos = cp2.positions.find((x) => x.instrument_id === sinPrecio);
  check('la posición existe', !!sinPrecioPos, true);
  check('NO vale cero', Number(sinPrecioPos.value_usd) > 0, true);
  check('usa el monto de la cartola', r2(sinPrecioPos.value_usd), 335.78);

  await writeSnapshots(today, U);
  const { rows: [snapSinPrecio] } = await query(
    `SELECT value_usd FROM position_snapshots
     WHERE user_id=$1 AND date=$2 AND instrument_id=$3`, [U, today, sinPrecio]);
  check('el snapshot tampoco la deja en cero', r2(snapSinPrecio.value_usd), 335.78);

  // Y cuando SÍ hay precio, manda el precio, no el monto.
  await query(`INSERT INTO prices (instrument_id, date, price_usd, price_clp, source)
               VALUES ($1,$2,400,380000,'test')
               ON CONFLICT (instrument_id, date) DO UPDATE SET price_usd=400`, [sinPrecio, today]);
  const cp3 = await computePositions(U);
  const conPrecio = cp3.positions.find((x) => x.instrument_id === sinPrecio);
  check('con precio, valoriza por unidades', r2(conPrecio.value_usd), r2(1.06411967 * 400));

  await query('DELETE FROM instruments WHERE id=$1', [sinPrecio]);

  console.log(fails === 0 ? '\n=== TODO OK ===' : `\n=== ${fails} FALLA(S) ===`);
} catch (e) {
  console.error('\nERROR:', e.message, '\n', e.stack?.split('\n').slice(0,5).join('\n'));
  fails++;
} finally {
  try { await query(`DELETE FROM instruments WHERE name LIKE 'Sin precio %'`); }
  catch (e) { console.error('(limpieza falló:', e.message, ')'); }
  await pool.end();
  process.exit(fails === 0 ? 0 : 1);
}
