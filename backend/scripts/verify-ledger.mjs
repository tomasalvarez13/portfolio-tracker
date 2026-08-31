// Verificación del ledger de la Fase 1.
//
// Ejerce ledgerService contra una base REAL: crea saldos, deltas, cierra
// posiciones y comprueba que `positions` derive bien de `transactions`.
//
// ESCRIBE DATOS. Por eso solo corre contra una base local:
//   docker run -d --name pt-dryrun -e POSTGRES_PASSWORD=dry -e POSTGRES_DB=dryrun \
//     -p 55432:5432 postgres:16-alpine
//   (aplicar schema.sql + invitations.sql + seed.sql + la migración 002)
//
//   DATABASE_URL="postgres://postgres:dry@localhost:55432/dryrun" \
//   SUPABASE_URL=http://localhost:54321 SUPABASE_ANON_KEY=x \
//   SUPABASE_SERVICE_ROLE_KEY=x npm run verify:ledger
//
// Espera un usuario con el UUID de abajo y los instrumentos de seed.sql.

const DB = process.env.DATABASE_URL || '';
if (!/localhost|127\.0\.0\.1/.test(DB)) {
  console.error('Este script escribe datos: solo corre contra una DATABASE_URL local.');
  console.error(`DATABASE_URL actual: ${DB || '(vacía)'}`);
  process.exit(1);
}


// Los imports son dinámicos a propósito: config/db.js abre el pool al
// evaluarse, así que la guardia de arriba tiene que correr primero.
const { query, pool } = await import('../src/config/db.js');
const {
  setBalance, recordMovement, closePosition,
  resolvePosition, rebuildPositionsForUser, deleteTransaction,
} = await import('../src/services/ledgerService.js');
const { computePositions } = await import('../src/services/portfolioService.js');

const U = '11111111-1111-1111-1111-111111111111';
let fails = 0;
const check = (name, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) fails++;
  console.log(`${ok ? '  ok  ' : ' FALLA'} ${name}: got=${got} want=${want}`);
};

const instId = async (t) => (await query('SELECT id FROM instruments WHERE ticker=$1 OR name=$2', [t, t])).rows[0].id;
const custId = async (s) => (await query('SELECT id FROM custodians WHERE slug=$1', [s])).rows[0].id;
const today  = new Date().toISOString().slice(0, 10);

try {
  const spy = await instId('SPY');
  const rn  = await instId('FM Fintual Risky Norris');
  const fintual  = await custId('fintual');
  const banchile = await custId('banchile');

  console.log('\n— setBalance crea la posición');
  await setBalance({ userId: U, custodianId: fintual, instrumentId: spy, date: today, units: 40 });
  let p = (await query('SELECT units FROM positions WHERE user_id=$1 AND custodian_id=$2 AND instrument_id=$3', [U, fintual, spy])).rows[0];
  check('units tras setBalance', Number(p.units), 40);

  console.log('\n— setBalance el mismo día corrige, no acumula');
  await setBalance({ userId: U, custodianId: fintual, instrumentId: spy, date: today, units: 55 });
  p = (await query('SELECT units FROM positions WHERE user_id=$1 AND custodian_id=$2 AND instrument_id=$3', [U, fintual, spy])).rows[0];
  check('units tras corregir', Number(p.units), 55);
  const nSaldos = (await query("SELECT count(*) c FROM transactions WHERE user_id=$1 AND instrument_id=$2 AND kind='saldo'", [U, spy])).rows[0].c;
  check('un solo saldo en el ledger', nSaldos, 1);

  console.log('\n— recordMovement suma un delta CON instrument_id (el bug viejo)');
  const mov = await recordMovement({
    userId: U, custodianId: fintual, instrumentId: spy, date: today,
    kind: 'aporte', units: 5, amountClp: 100000,
  });
  check('el movimiento guarda instrument_id', mov.instrument_id, spy);
  check('el movimiento guarda custodian_id', mov.custodian_id, fintual);
  p = (await query('SELECT units FROM positions WHERE user_id=$1 AND custodian_id=$2 AND instrument_id=$3', [U, fintual, spy])).rows[0];
  check('units tras el aporte', Number(p.units), 60);

  console.log('\n— mismo activo en dos custodios convive');
  await setBalance({ userId: U, custodianId: banchile, instrumentId: rn, date: today, units: 111 });
  await setBalance({ userId: U, custodianId: fintual,  instrumentId: rn, date: today, units: 222 });
  const dos = (await query('SELECT count(*) c FROM positions WHERE user_id=$1 AND instrument_id=$2', [U, rn])).rows[0].c;
  check('filas del mismo activo', dos, 3); // banchile + fintual + sin-custodio (del seed)

  console.log('\n— computePositions expone el custodio');
  const cp = await computePositions(U);
  const conCustodio = cp.positions.filter((x) => x.custodian_name).length;
  check('todas traen custodian_name', conCustodio, cp.positions.length);
  const spyPos = cp.positions.find((x) => x.instrument_id === spy && x.custodian_id === fintual);
  check('valorización del SPY en Fintual', spyPos ? Math.round(spyPos.value_clp) : 'sin fila', Math.round(60 * 95000));

  console.log('\n— closePosition borra la fila pero deja el historial');
  const pos = (await query('SELECT id FROM positions WHERE user_id=$1 AND custodian_id=$2 AND instrument_id=$3', [U, fintual, spy])).rows[0];
  await closePosition({ userId: U, custodianId: fintual, instrumentId: spy, date: today });
  const quedan = (await query('SELECT count(*) c FROM positions WHERE user_id=$1 AND custodian_id=$2 AND instrument_id=$3', [U, fintual, spy])).rows[0].c;
  check('filas de la posición cerrada', quedan, 0);
  const hist = (await query('SELECT count(*) c FROM transactions WHERE user_id=$1 AND custodian_id=$2 AND instrument_id=$3', [U, fintual, spy])).rows[0].c;
  check('historial intacto en el ledger', Number(hist) >= 2, true);
  check('resolvePosition ya no la encuentra', await resolvePosition(U, pos.id), null);

  console.log('\n— deleteTransaction recalcula la posición');
  const before = Number((await query('SELECT units FROM positions WHERE user_id=$1 AND custodian_id=$2 AND instrument_id=$3', [U, banchile, rn])).rows[0].units);
  const extra = await recordMovement({ userId: U, custodianId: banchile, instrumentId: rn, date: today, kind: 'aporte', units: 9 });
  const mid = Number((await query('SELECT units FROM positions WHERE user_id=$1 AND custodian_id=$2 AND instrument_id=$3', [U, banchile, rn])).rows[0].units);
  check('tras el aporte', mid, before + 9);
  await deleteTransaction(U, extra.id);
  const after = Number((await query('SELECT units FROM positions WHERE user_id=$1 AND custodian_id=$2 AND instrument_id=$3', [U, banchile, rn])).rows[0].units);
  check('tras borrar el movimiento', after, before);

  console.log('\n— rebuild total es idempotente');
  const snap = (await query('SELECT user_id,custodian_id,instrument_id,units,amount_clp,amount_usd FROM positions ORDER BY 1,2,3')).rows;
  await rebuildPositionsForUser(U);
  const snap2 = (await query('SELECT user_id,custodian_id,instrument_id,units,amount_clp,amount_usd FROM positions ORDER BY 1,2,3')).rows;
  check('mismo resultado tras rebuild', JSON.stringify(snap) === JSON.stringify(snap2), true);

  console.log('\n— recordMovement rechaza un kind inválido');
  try {
    await recordMovement({ userId: U, instrumentId: spy, date: today, kind: 'saldo', units: 1 });
    check('rechaza kind=saldo', 'no lanzó', 'lanza');
  } catch { check('rechaza kind=saldo', 'lanza', 'lanza'); }

  console.log(fails === 0 ? '\n=== TODO OK ===' : `\n=== ${fails} FALLA(S) ===`);
} catch (e) {
  console.error('\nERROR:', e.message, '\n', e.stack?.split('\n').slice(0,4).join('\n'));
  fails++;
} finally {
  await pool.end();
  process.exit(fails === 0 ? 0 : 1);
}
