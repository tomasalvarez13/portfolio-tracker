// Verificación del flujo de cartolas (§3.1 del plan).
//
// Cubre: normalización de lo que devuelve el modelo, matching contra el maestro
// por trigramas, idempotencia por hash, confirmación transaccional al ledger,
// alta de activos pending_mapping y fusión de duplicados.
//
// NO cubre la llamada a Gemini: eso necesita GEMINI_API_KEY y una cartola real.
// La extracción se ejercita con respuestas simuladas vía normalizeParse().
//
// ESCRIBE DATOS. Solo corre contra una base local:
//   DATABASE_URL="postgres://postgres:dry@localhost:55432/dryrun" \
//   SUPABASE_URL=http://localhost:54321 SUPABASE_ANON_KEY=x \
//   SUPABASE_SERVICE_ROLE_KEY=x npm run verify:cartola

const DB = process.env.DATABASE_URL || '';
if (!/localhost|127\.0\.0\.1/.test(DB)) {
  console.error('Este script escribe datos: solo corre contra una DATABASE_URL local.');
  console.error(`DATABASE_URL actual: ${DB || '(vacía)'}`);
  process.exit(1);
}

// Dinámicos: config/db.js abre el pool al evaluarse, la guardia va primero.
const { query, pool } = await import('../src/config/db.js');
const { normalizeParse } = await import('../src/services/cartolaParser.js');
const { sha256, saveStatement, withCandidates, matchCustodian, confirmStatement, listStatements } =
  await import('../src/services/statementService.js');
const { rebuildPositionsForUser } = await import('../src/services/ledgerService.js');

const U = '11111111-1111-1111-1111-111111111111';
// Sufijo por corrida: el script crea activos y cartolas, y sin aislarlos los
// artefactos se acumulan entre corridas y rompen sus propias aserciones.
const RUN = (await query('SELECT to_char(clock_timestamp(), \'HH24MISSMS\') AS t')).rows[0].t;
const DEP = `Depósito Banco Estado ${RUN}`;
const MERGE_NAMES = [`Merge origen ${RUN}`, `Merge destino ${RUN}`];
let fails = 0;
const check = (n, got, want) => { const ok = String(got)===String(want); if(!ok) fails++; console.log(`${ok?'  ok  ':' FALLA'} ${n}: got=${got} want=${want}`); };

try {
  console.log('\n— normalizeParse filtra ruido y tolera basura del modelo');
  const np = normalizeParse({
    custodian_name: '  Fintual  ', statement_date: '2026-07-31',
    rows: [
      { instrument_name: 'RISKY NORRIS SERIE A', units: '1234.5678' },
      { instrument_name: 'TOTAL CARTOLA', units: 0 },
      { instrument_name: '', units: 99 },
      { instrument_name: 'Amazon.com, Inc.', amount_usd: 4200.5, notes: '  ' },
      { instrument_name: 'Fondo Inexistente SA', amount_clp: 'no-es-numero' },
      { instrument_name: DEP, amount_clp: 3000000 },
    ],
  });
  check('custodio detectado', np.custodian_name, 'Fintual');
  check('fecha de cartola', np.statement_date, '2026-07-31');
  check('filas válidas (descarta total, vacía y no-numérica)', np.rows.length, 3);
  check('units parseado como número', np.rows[0].units, 1234.5678);
  check('notes en blanco pasa a null', np.rows[1].notes, null);
  check('fecha inválida se descarta', normalizeParse({ statement_date: '31/07/2026' }).statement_date, null);
  check('array pelado también funciona', normalizeParse([{ instrument_name: 'X', units: 1 }]).rows.length, 1);

  console.log('\n— matchCustodian adivina el custodio del documento');
  check('Fintual', (await matchCustodian('Fintual'))?.slug, 'fintual');
  check('"Banchile Inversiones S.A."', (await matchCustodian('Banchile Inversiones S.A.'))?.slug, 'banchile');
  check('institución desconocida no adivina', await matchCustodian('Banco Marte'), null);

  console.log('\n— guardar la cartola es idempotente por hash');
  const hash = sha256(Buffer.from(`pdf-falso-${RUN}`));
  const fintual = (await query(`SELECT id FROM custodians WHERE slug='fintual'`)).rows[0].id;
  const s1 = await saveStatement({ userId: U, custodianId: fintual, fileHash: hash, fileName: 'cartola.pdf', parsed: np });
  const s2 = await saveStatement({ userId: U, custodianId: fintual, fileHash: hash, fileName: 'cartola.pdf', parsed: np });
  check('mismo id al resubir el mismo archivo', s1.id, s2.id);
  check('una sola fila en statements', (await query('SELECT count(*) c FROM statements WHERE user_id=$1 AND file_hash=$2',[U,hash])).rows[0].c, 1);
  check('rows_proposed guardado', s1.rows_proposed, 3);

  console.log('\n— cada fila viene con candidatos del maestro');
  const withCand = await withCandidates(U, np.rows);
  check('RISKY NORRIS matchea Risky Norris', withCand[0].candidates[0]?.name, 'FM Fintual Risky Norris');
  check('Amazon.com, Inc. matchea Amazon', withCand[1].candidates[0]?.name, 'Amazon.com Inc');
  check('el activo que no existe no tiene candidatos', withCand[2].candidates.length, 0);

  console.log('\n— confirmar escribe saldos con la fecha de la CARTOLA, no la de hoy');
  const res1 = await confirmStatement({ userId: U, statementId: s1.id, rows: [
    { instrument_id: withCand[0].candidates[0].id, units: 1234.5678 },
    { instrument_id: withCand[1].candidates[0].id, amount_usd: 4200.5 },
    { instrument_name: DEP, amount_clp: 3000000, create_instrument: true, type: 'fondo_mutuo_cl' },
  ]});
  check('filas aplicadas', res1.applied, 3);
  check('fecha usada = fecha de la cartola', res1.date, '2026-07-31');
  check('activos creados', res1.created.length, 1);
  check('el activo nuevo quedó pending_mapping', (await query(
    'SELECT status FROM instruments WHERE name=$1', [DEP])).rows[0].status, 'pending_mapping');
  check('la transacción quedó ligada a la cartola', (await query(
    'SELECT count(*) c FROM transactions WHERE statement_id=$1', [s1.id])).rows[0].c, 3);
  check('los saldos van al custodio de la cartola', (await query(
    `SELECT count(*) c FROM transactions WHERE statement_id=$1 AND custodian_id=$2`, [s1.id, fintual])).rows[0].c, 3);
  check('statements quedó confirmed', (await query('SELECT status FROM statements WHERE id=$1',[s1.id])).rows[0].status, 'confirmed');

  console.log('\n— reprocesar la MISMA cartola no duplica ni cambia el resultado');
  const antes = (await query(`SELECT instrument_id, units, amount_clp, amount_usd FROM positions WHERE user_id=$1 ORDER BY 1`,[U])).rows;
  const res2 = await confirmStatement({ userId: U, statementId: s1.id, rows: [
    { instrument_id: withCand[0].candidates[0].id, units: 1234.5678 },
    { instrument_id: withCand[1].candidates[0].id, amount_usd: 4200.5 },
  ]});
  const despues = (await query(`SELECT instrument_id, units, amount_clp, amount_usd FROM positions WHERE user_id=$1 ORDER BY 1`,[U])).rows;
  check('posiciones idénticas', JSON.stringify(antes)===JSON.stringify(despues), true);
  check('sin transacciones duplicadas', (await query(
    'SELECT count(*) c FROM transactions WHERE statement_id=$1',[s1.id])).rows[0].c, 3);

  console.log('\n— el confirm es atómico: una fila inválida no deja las otras aplicadas');
  const hash2 = sha256(Buffer.from(`otro-pdf-${RUN}`));
  const s3 = await saveStatement({ userId: U, custodianId: fintual, fileHash: hash2, parsed: { statement_date: '2026-06-30', rows: [] } });
  const txAntes = (await query('SELECT count(*) c FROM transactions WHERE user_id=$1',[U])).rows[0].c;
  let lanzo = false;
  try {
    await confirmStatement({ userId: U, statementId: s3.id, rows: [
      { instrument_id: withCand[0].candidates[0].id, units: 5 },
      { instrument_id: 999999, units: 10 },   // FK inválida -> revienta
    ]});
  } catch { lanzo = true; }
  check('lanzó', lanzo, true);
  check('no quedó ninguna transacción de esa cartola', (await query(
    'SELECT count(*) c FROM transactions WHERE statement_id=$1',[s3.id])).rows[0].c, 0);
  check('el total de transacciones no se movió', (await query(
    'SELECT count(*) c FROM transactions WHERE user_id=$1',[U])).rows[0].c, txAntes);

  console.log('\n— merge_instruments fusiona sin perder plata');
  // Dos activos creados por el test, para no depender del estado del maestro ni
  // de lo que hayan dejado otros scripts. Antes esto usaba un activo del seed y
  // fallaba cuando verify-snapshots le había dejado un saldo posterior en cero:
  // el saldo más nuevo supersede al viejo, así que la suma del merge quedaba
  // pisada. Ese comportamiento es el correcto; la aserción era la equivocada.
  const mk = async (nombre) => (await query(
    `INSERT INTO instruments (name, type, currency, api_source, status, created_by)
     VALUES ($2,'fondo_mutuo_cl','CLP','manual','pending_mapping',$1) RETURNING id`,
    [U, nombre])).rows[0].id;
  const srcId = await mk(`Merge origen ${RUN}`);
  const dstId = await mk(`Merge destino ${RUN}`);
  await confirmStatement({ userId: U, statementId: s1.id, rows: [
    { instrument_id: srcId, units: 100 },
    { instrument_id: dstId, units: 50 },
  ]});
  const sum2 = async () => Number((await query(
    `SELECT COALESCE(SUM(units),0) s FROM positions WHERE user_id=$1 AND instrument_id IN ($2,$3)`,
    [U, srcId, dstId])).rows[0].s);
  const totalAntes = await sum2();
  check('estado inicial del merge', totalAntes, 150);

  const m = (await query('SELECT * FROM merge_instruments($1,$2)', [srcId, dstId])).rows[0];
  check('unidades totales se conservan', await sum2(), 150);
  check('el destino concentra todo', Number((await query(
    'SELECT units FROM positions WHERE user_id=$1 AND instrument_id=$2', [U, dstId])).rows[0].units), 150);
  check('el origen no tiene más posiciones', (await query(
    'SELECT count(*) c FROM positions WHERE instrument_id=$1', [srcId])).rows[0].c, 0);
  check('el origen apunta al canónico', (await query(
    'SELECT canonical_id FROM instruments WHERE id=$1', [srcId])).rows[0].canonical_id, dstId);
  check('el origen dejó de ser candidato', (await query(
    'SELECT count(*) c FROM match_instruments($2, $1, 10) WHERE id=$3',
    [U, `Merge origen ${RUN}`, srcId])).rows[0].c, 0);
  check('reporta los saldos que sumó', m.saldos_sumados > 0, true);

  console.log('\n— rebuild total sigue dando lo mismo tras todo esto');
  const pre = JSON.stringify((await query(`SELECT custodian_id,instrument_id,units,amount_clp,amount_usd FROM positions WHERE user_id=$1 ORDER BY 1,2`,[U])).rows);
  await rebuildPositionsForUser(U);
  const post = JSON.stringify((await query(`SELECT custodian_id,instrument_id,units,amount_clp,amount_usd FROM positions WHERE user_id=$1 ORDER BY 1,2`,[U])).rows);
  check('posiciones estables', pre===post, true);

  console.log('\n— historial de cartolas');
  const hist = await listStatements(U);
  check('lista las dos cartolas', hist.length >= 2, true);
  check('trae el nombre del custodio', hist.some(h => h.custodian_name === 'Fintual'), true);

  console.log(fails===0 ? '\n=== TODO OK ===' : `\n=== ${fails} FALLA(S) ===`);
} catch (e) {
  console.error('\nERROR:', e.message, '\n', e.stack?.split('\n').slice(0,5).join('\n')); fails++;
} finally {
  // Limpieza: sin esto los artefactos de esta corrida rompen las siguientes y
  // contaminan los otros scripts de verificación.
  try {
    await query('DELETE FROM transactions WHERE user_id=$1 AND instrument_id IN (SELECT id FROM instruments WHERE name = ANY($2))', [U, [DEP, ...MERGE_NAMES]]);
    await query('DELETE FROM positions    WHERE user_id=$1 AND instrument_id IN (SELECT id FROM instruments WHERE name = ANY($2))', [U, [DEP, ...MERGE_NAMES]]);
    await query('DELETE FROM position_snapshots WHERE user_id=$1 AND instrument_id IN (SELECT id FROM instruments WHERE name = ANY($2))', [U, [DEP, ...MERGE_NAMES]]);
    await query('DELETE FROM instruments  WHERE name = ANY($1)', [[DEP, ...MERGE_NAMES]]);
    await query('DELETE FROM statements   WHERE user_id=$1 AND file_hash IN ($2,$3)', [U, sha256(Buffer.from(`pdf-falso-${RUN}`)), sha256(Buffer.from(`otro-pdf-${RUN}`))]);
    await rebuildPositionsForUser(U);
  } catch (e) { console.error('(limpieza falló:', e.message, ')'); }
  await pool.end();
  process.exit(fails===0?0:1);
}
