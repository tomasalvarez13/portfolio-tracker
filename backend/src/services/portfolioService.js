// Lógica de portafolio: valorización de posiciones, snapshots diarios,
// resumen del día y cálculo de rentabilidad (total y sobre lo invertido).

import { query } from '../config/db.js';
import { todayCL } from '../utils/dates.js';


// pg devuelve columnas DATE como objetos Date. Normaliza a 'YYYY-MM-DD'
// usando componentes locales (evita corrimientos de día por timezone).
function toISODate(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Valoriza todas las posiciones de un usuario al último precio disponible.
 * Convierte con el dólar más reciente. Calcula % del portafolio.
 * @returns {Promise<{positions: object[], totalClp: number, totalUsd: number, priceDate: string|null}>}
 */
export async function computePositions(userId) {
  // Último dólar
  const { rows: dolarRows } = await query(
    `SELECT usd_clp, date FROM exchange_rates ORDER BY date DESC LIMIT 1`
  );
  const usdClp = dolarRows[0] ? Number(dolarRows[0].usd_clp) : null;

  // Posiciones + instrumento + último precio (vía vista latest_prices)
  const { rows } = await query(
    `SELECT p.id, p.units, p.amount_clp, p.amount_usd, p.notes, p.updated_at,
            p.custodian_id, c.name AS custodian_name,
            i.id AS instrument_id, i.name, i.alias, i.type, i.ticker, i.currency, i.api_source,
            lp.price_clp, lp.price_usd, lp.date AS price_date, lp.is_stale
     FROM positions p
     JOIN instruments i ON i.id = p.instrument_id
     JOIN custodians  c ON c.id = p.custodian_id
     LEFT JOIN latest_prices lp ON lp.instrument_id = i.id
     WHERE p.user_id = $1
     ORDER BY i.type, i.name, c.name`,
    [userId]
  );

  let totalClp = 0;
  let totalUsd = 0;
  let latestPriceDate = null;

  const positions = rows.map((r) => {
    let valueClp = null;
    let valueUsd = null;

    const pClp = r.price_clp != null ? Number(r.price_clp) : null;
    const pUsd = r.price_usd != null ? Number(r.price_usd) : null;

    // Un activo sin fuente de precios —recién creado desde una cartola, por
    // ejemplo— puede tener units pero ningún precio jamás. Antes esto era un
    // `if (r.units != null)` sin salida: la posición valía CERO y desaparecía
    // del patrimonio en silencio. Ahora, si hay units pero no hay precio, se
    // cae al monto que declaró la cartola: estático, pero real.
    if (r.units != null && (pClp != null || pUsd != null)) {
      if (pClp != null) valueClp = Number(r.units) * pClp;
      if (pUsd != null) valueUsd = Number(r.units) * pUsd;
      if (valueClp == null && valueUsd != null && usdClp) valueClp = valueUsd * usdClp;
      if (valueUsd == null && valueClp != null && usdClp) valueUsd = valueClp / usdClp;
    } else if (r.amount_clp != null) {
      valueClp = Number(r.amount_clp);
      if (usdClp) valueUsd = valueClp / usdClp;
    } else if (r.amount_usd != null) {
      valueUsd = Number(r.amount_usd);
      if (usdClp) valueClp = valueUsd * usdClp;
    }

    if (valueClp != null) totalClp += valueClp;
    if (valueUsd != null) totalUsd += valueUsd;
    if (r.price_date && (!latestPriceDate || r.price_date > latestPriceDate)) {
      latestPriceDate = r.price_date;
    }

    return {
      id: r.id,
      instrument_id: r.instrument_id,
      custodian_id: r.custodian_id,
      custodian_name: r.custodian_name,
      name: r.name,
      alias: r.alias,
      type: r.type,
      ticker: r.ticker,
      currency: r.currency,
      api_source: r.api_source,
      units: r.units != null ? Number(r.units) : null,
      amount_clp: r.amount_clp != null ? Number(r.amount_clp) : null,
      amount_usd: r.amount_usd != null ? Number(r.amount_usd) : null,
      price_clp: r.price_clp != null ? Number(r.price_clp) : null,
      price_usd: r.price_usd != null ? Number(r.price_usd) : null,
      price_date: r.price_date,
      is_stale: r.is_stale,
      value_clp: valueClp,
      value_usd: valueUsd,
      notes: r.notes,
    };
  });

  // % del portafolio
  for (const p of positions) {
    p.pct_portfolio = totalClp > 0 && p.value_clp != null ? (p.value_clp / totalClp) * 100 : 0;
  }

  return { positions, totalClp, totalUsd, priceDate: latestPriceDate };
}

/** Agrupa por tipo de instrumento (para donut/barras). */
export async function computeBreakdown(userId) {
  const { positions, totalClp } = await computePositions(userId);
  const map = new Map();
  for (const p of positions) {
    const cur = map.get(p.type) || { type: p.type, total_clp: 0, total_usd: 0 };
    cur.total_clp += p.value_clp || 0;
    cur.total_usd += p.value_usd || 0;
    map.set(p.type, cur);
  }
  const breakdown = [...map.values()].map((b) => ({
    ...b,
    pct: totalClp > 0 ? (b.total_clp / totalClp) * 100 : 0,
  }));
  breakdown.sort((a, b) => b.total_clp - a.total_clp);
  return breakdown;
}

/* ───────────────────────── SNAPSHOTS ─────────────────────────
 * Antes esto era un loop en JS: por cada usuario, computePositions() con 2+
 * queries, y un INSERT. O(usuarios) round-trips en una sola request HTTP — el
 * primer cuello de botella que aparece al crecer.
 *
 * Ahora son cuatro statements que procesan a todos los usuarios de una, con la
 * misma lógica de valorización que computePositions() pero en SQL. Se puede
 * acotar a un usuario pasando userId, y ese es el único camino: una sola
 * implementación para el cron y para las rutas.
 * ───────────────────────────────────────────────────────────── */

// El dólar más reciente, como subconsulta escalar. Si `exchange_rates` está
// vacía da NULL, y la aritmética propaga NULL — igual que el `if (usdClp)` del
// código viejo, que simplemente no convertía.
const FX = `(SELECT usd_clp FROM exchange_rates ORDER BY date DESC LIMIT 1)`;

// Réplica exacta del orden de precedencia de computePositions():
// units × precio primero, después amount_clp, después amount_usd.
const VALUED = `
  SELECT p.user_id, p.custodian_id, p.instrument_id, p.units,
         lp.price_clp,
         -- Una posición valorizada con un precio de carry-forward no tiene un
         -- valor "de ese día". Se marca para que el número se pueda señalar.
         COALESCE(lp.is_stale, FALSE) AS is_stale,
         -- El COALESCE de units ya no alcanza: si el instrumento NUNCA tuvo
         -- precio, las dos ramas dan NULL y la posición valía cero. La
         -- condición exige que exista algún precio para valorizar por unidades;
         -- si no, cae al monto declarado. Mismo criterio que computePositions.
         CASE
           WHEN p.units IS NOT NULL AND (lp.price_clp IS NOT NULL OR lp.price_usd IS NOT NULL)
                                         THEN COALESCE(p.units * lp.price_clp,
                                                       p.units * lp.price_usd * ${FX})
           WHEN p.amount_clp IS NOT NULL THEN p.amount_clp
           WHEN p.amount_usd IS NOT NULL THEN p.amount_usd * ${FX}
         END AS value_clp,
         CASE
           WHEN p.units IS NOT NULL AND (lp.price_clp IS NOT NULL OR lp.price_usd IS NOT NULL)
                                         THEN COALESCE(p.units * lp.price_usd,
                                                       p.units * lp.price_clp / ${FX})
           WHEN p.amount_usd IS NOT NULL THEN p.amount_usd
           WHEN p.amount_clp IS NOT NULL THEN p.amount_clp / ${FX}
         END AS value_usd
  FROM positions p
  LEFT JOIN latest_prices lp ON lp.instrument_id = p.instrument_id`;

/**
 * Escribe `position_snapshots` y `portfolio_snapshots` para una fecha.
 * @param {string} date  'YYYY-MM-DD'
 * @param {string|null} userId  null = todos los usuarios
 * @returns {Promise<{date:string, users:number, positions:number}>}
 */
export async function writeSnapshots(date = todayCL(), userId = null) {
  const scopePos  = userId ? 'WHERE p.user_id = $2'  : '';
  const params    = userId ? [date, userId] : [date];

  // 1. Un snapshot por posición. Es la tabla que habilita las vistas por activo
  //    y por custodio: `portfolio_snapshots` solo guarda totales y breakdown por
  //    tipo, así que no permite reconstruir cuánto valía un activo puntual.
  const { rowCount: nPositions } = await query(
    `INSERT INTO position_snapshots
       (user_id, date, custodian_id, instrument_id, units, price_clp, value_clp, value_usd, is_stale)
     SELECT v.user_id, $1, v.custodian_id, v.instrument_id, v.units,
            v.price_clp, v.value_clp, v.value_usd, v.is_stale
     FROM (${VALUED} ${scopePos}) v
     ON CONFLICT (user_id, date, custodian_id, instrument_id)
     DO UPDATE SET units     = EXCLUDED.units,
                   price_clp = EXCLUDED.price_clp,
                   value_clp = EXCLUDED.value_clp,
                   value_usd = EXCLUDED.value_usd,
                   is_stale  = EXCLUDED.is_stale`,
    params
  );

  // 2. Limpiar las filas del día que ya no corresponden a ninguna posición.
  //    Sin esto, cerrar una posición y volver a snapshotear el mismo día dejaría
  //    la fila vieja adentro y el total no cuadraría con la suma.
  await query(
    `DELETE FROM position_snapshots ps
     WHERE ps.date = $1
       ${userId ? 'AND ps.user_id = $2' : ''}
       AND NOT EXISTS (
         SELECT 1 FROM positions p
         WHERE p.user_id       = ps.user_id
           AND p.custodian_id  = ps.custodian_id
           AND p.instrument_id = ps.instrument_id
       )`,
    params
  );

  // 3. `portfolio_snapshots` pasa a ser una agregación de lo de arriba, no un
  //    cálculo paralelo. Así los totales no pueden divergir del detalle.
  const { rowCount: nUsers } = await query(
    `WITH by_type AS (
       SELECT ps.user_id, i.type,
              SUM(ps.value_clp) AS clp,
              SUM(ps.value_usd) AS usd,
              count(*) FILTER (WHERE ps.is_stale) AS stale
       FROM position_snapshots ps
       JOIN instruments i ON i.id = ps.instrument_id
       WHERE ps.date = $1 ${userId ? 'AND ps.user_id = $2' : ''}
       GROUP BY ps.user_id, i.type
     )
     INSERT INTO portfolio_snapshots (user_id, date, total_clp, total_usd, breakdown, stale_positions)
     SELECT user_id, $1,
            COALESCE(SUM(clp), 0),
            COALESCE(SUM(usd), 0),
            jsonb_object_agg(type, jsonb_build_object('clp', COALESCE(clp, 0),
                                                      'usd', COALESCE(usd, 0))),
            COALESCE(SUM(stale), 0)
     FROM by_type
     GROUP BY user_id
     ON CONFLICT (user_id, date)
     DO UPDATE SET total_clp       = EXCLUDED.total_clp,
                   total_usd       = EXCLUDED.total_usd,
                   breakdown       = EXCLUDED.breakdown,
                   stale_positions = EXCLUDED.stale_positions`,
    params
  );

  // 4. Quien se quedó sin posiciones pero ya tenía historia necesita un cero
  //    explícito: si no, el gráfico se corta en vez de bajar a cero.
  await query(
    `INSERT INTO portfolio_snapshots (user_id, date, total_clp, total_usd, breakdown)
     SELECT u.id, $1, 0, 0, '{}'::jsonb
     FROM users u
     WHERE ${userId ? 'u.id = $2' : 'TRUE'}
       AND NOT EXISTS (SELECT 1 FROM positions p WHERE p.user_id = u.id)
       AND EXISTS (SELECT 1 FROM portfolio_snapshots s
                   WHERE s.user_id = u.id AND s.date < $1)
     ON CONFLICT (user_id, date)
     DO UPDATE SET total_clp = 0, total_usd = 0, breakdown = '{}'::jsonb`,
    params
  );

  return { date, users: nUsers, positions: nPositions };
}

/**
 * Snapshot de un usuario. Mantiene la firma y el shape de retorno de antes
 * porque lo usan las rutas de positions, movements y portfolio.
 * @returns {Promise<{date:string, total_clp:number, total_usd:number, breakdown:object}>}
 */
export async function computeAndSaveSnapshot(userId, date = todayCL()) {
  await writeSnapshots(date, userId);

  const { rows } = await query(
    `SELECT date, total_clp, total_usd, breakdown FROM portfolio_snapshots
     WHERE user_id = $1 AND date = $2`,
    [userId, date]
  );

  // Sin posiciones y sin historia previa no se escribe fila: no es un error.
  if (!rows[0]) return { date, total_clp: 0, total_usd: 0, breakdown: {} };

  return {
    date: toISODate(rows[0].date),
    total_clp: Number(rows[0].total_clp),
    total_usd: Number(rows[0].total_usd),
    breakdown: rows[0].breakdown,
  };
}

/** Snapshots del día para TODOS los usuarios. Lo llama el cron. */
export async function snapshotAllUsers(date = todayCL()) {
  const r = await writeSnapshots(date);
  console.log(`[portfolioService] snapshots ${r.date}: ${r.users} usuario(s), ${r.positions} posición(es)`);
  return r;
}

/** Resumen del día: total actual + variación vs día anterior (desde snapshots). */
export async function getSummary(userId) {
  const { totalClp, totalUsd, priceDate } = await computePositions(userId);

  // Último snapshot anterior para variación
  const { rows } = await query(
    `SELECT date, total_clp, total_usd FROM portfolio_snapshots
     WHERE user_id = $1 ORDER BY date DESC LIMIT 2`,
    [userId]
  );

  // rows[0] sería hoy si ya hay snapshot; usamos el más reciente que sea < hoy.
  const today = todayCL();
  const prev = rows.find((r) => r.date < today) || rows[1] || null;

  let changeClp = null, changePct = null;
  if (prev) {
    const prevClp = Number(prev.total_clp);
    changeClp = totalClp - prevClp;
    changePct = prevClp > 0 ? (changeClp / prevClp) * 100 : null;
  }

  return {
    total_clp: totalClp,
    total_usd: totalUsd,
    price_date: priceDate,
    change_clp: changeClp,
    change_pct: changePct,
    prev_date: prev?.date || null,
  };
}

/** Snapshots históricos para el gráfico evolutivo. */
export async function getSnapshots(userId, from, to) {
  const clauses = ['user_id = $1'];
  const params = [userId];
  if (from) { params.push(from); clauses.push(`date >= $${params.length}`); }
  if (to) { params.push(to); clauses.push(`date <= $${params.length}`); }
  const { rows } = await query(
    `SELECT date, total_clp, total_usd, breakdown, stale_positions
     FROM portfolio_snapshots
     WHERE ${clauses.join(' AND ')} ORDER BY date ASC`,
    params
  );
  return rows.map((r) => ({
    date: toISODate(r.date),
    total_clp: Number(r.total_clp),
    total_usd: Number(r.total_usd),
    breakdown: r.breakdown,
    // Cuántas posiciones de ese día se valorizaron con un precio de
    // carry-forward. El total sigue siendo el que corresponde; esto permite
    // marcar el punto en el gráfico en vez de descartarlo.
    stale_positions: Number(r.stale_positions ?? 0),
  }));
}

/** Aportes netos (aportes - retiros) en CLP dentro de un rango. */
async function netAportes(userId, from, to) {
  const { rows } = await query(
    `SELECT
       COALESCE(SUM(CASE WHEN type='aporte' THEN amount_clp ELSE 0 END), 0) AS aportes,
       COALESCE(SUM(CASE WHEN type='retiro' THEN amount_clp ELSE 0 END), 0) AS retiros
     FROM movements
     WHERE user_id = $1 AND date >= $2 AND date <= $3`,
    [userId, from, to]
  );
  const aportes = Number(rows[0].aportes);
  const retiros = Number(rows[0].retiros);
  return { aportes, retiros, neto: aportes - retiros };
}

/** Valor del portafolio (CLP) en una fecha, desde el snapshot más cercano <= fecha. */
async function valueAt(userId, date) {
  const { rows } = await query(
    `SELECT date, total_clp FROM portfolio_snapshots
     WHERE user_id = $1 AND date <= $2 ORDER BY date DESC LIMIT 1`,
    [userId, date]
  );
  return rows[0] ? { date: rows[0].date, total_clp: Number(rows[0].total_clp) } : null;
}

/**
 * Rentabilidad del período.
 *   total      = (Vf - Vi) / Vi
 *   s/invertido= (Vf - Vi - Aportes) / (Vi + Aportes)
 */
export async function getRentabilidad(userId, from, to) {
  const vi = await valueAt(userId, from);
  const vf = await valueAt(userId, to);
  if (!vi || !vf) {
    return { error: 'Sin snapshots suficientes en el rango', valor_inicial_clp: vi?.total_clp ?? null, valor_final_clp: vf?.total_clp ?? null };
  }
  const { neto: aportesNetos, aportes, retiros } = await netAportes(userId, from, to);

  const valorInicial = vi.total_clp;
  const valorFinal = vf.total_clp;

  const rentTotalClp = valorFinal - valorInicial;
  const rentTotalPct = valorInicial > 0 ? (rentTotalClp / valorInicial) * 100 : null;

  const baseInvertida = valorInicial + aportesNetos;
  const rentInvertidaClp = valorFinal - valorInicial - aportesNetos;
  const rentInvertidaPct = baseInvertida > 0 ? (rentInvertidaClp / baseInvertida) * 100 : null;

  return {
    from: vi.date,
    to: vf.date,
    valor_inicial_clp: valorInicial,
    valor_final_clp: valorFinal,
    aportes_periodo_clp: aportes,
    retiros_periodo_clp: retiros,
    aportes_netos_clp: aportesNetos,
    rentabilidad_total_clp: rentTotalClp,
    rentabilidad_total_pct: rentTotalPct,
    rentabilidad_sobre_invertido_clp: rentInvertidaClp,
    rentabilidad_sobre_invertido_pct: rentInvertidaPct,
  };
}

/**
 * Time-Weighted Return (TWR) — método estándar de la industria.
 * Divide el período en sub-períodos por cada movimiento (aporte/retiro),
 * calcula el rendimiento de cada uno, y los multiplica geométricamente.
 *
 * Esto mide la rentabilidad real de la plata, independiente de cuándo se aportó.
 * Es el método que usan Fintual, AFP y los fondos mutuos para reportar rentabilidad.
 *
 * Devuelve: { twr_pct, twr_clp_aprox, sub_periods, aportes_clp, retiros_clp }
 */
export async function computeTWR(userId, from, to) {
  // 1. Snapshots del rango (ascendente)
  const snapshots = await getSnapshots(userId, from, to);
  if (snapshots.length < 2) {
    return { twr_pct: null, error: 'No hay suficientes snapshots en el rango' };
  }

  // 2. Movimientos (aportes/retiros a nivel portafolio) en el rango
  const { rows: movs } = await query(
    `SELECT date, type, COALESCE(amount_clp, 0) AS amount_clp
     FROM movements
     WHERE user_id = $1 AND instrument_id IS NULL
       AND date > $2 AND date <= $3
     ORDER BY date ASC`,
    [userId, from, to]
  );

  // 3. Construir sub-períodos por cada movimiento
  // Para cada movimiento en fecha D:
  //   - V_end = valor del snapshot en D-1 (último antes del aporte)
  //   - sub-período: [V_start ... V_end]
  //   - V_start del siguiente sub-período = V_end + signo*monto
  //
  // Si no hay snapshot exacto en D-1, se usa el snapshot más cercano <= D-1.
  const snapByDate = new Map(snapshots.map((s) => [s.date, s.total_clp]));
  const sortedDates = snapshots.map((s) => s.date);

  function snapBefore(date) {
    let best = null;
    for (const d of sortedDates) {
      if (d < date) best = d;
      else break;
    }
    return best ? { date: best, value: snapByDate.get(best) } : null;
  }

  const subPeriods = [];
  let cursorValue = snapshots[0].total_clp;
  let cursorDate = snapshots[0].date;

  for (const m of movs) {
    const movDate = toISODate(m.date);
    const before = snapBefore(movDate);
    if (!before || before.date < cursorDate) continue;
    const vEnd = Number(before.value);
    const r = cursorValue > 0 ? (vEnd / cursorValue) - 1 : 0;
    subPeriods.push({ from: cursorDate, to: before.date, r });
    // Después del movimiento, el portafolio "vale" vEnd + signo*monto
    const signo = m.type === 'aporte' ? 1 : -1;
    cursorValue = vEnd + signo * Number(m.amount_clp);
    cursorDate = movDate;
  }

  // Sub-período final hasta el último snapshot
  const last = snapshots[snapshots.length - 1];
  if (last.date > cursorDate) {
    const r = cursorValue > 0 ? (last.total_clp / cursorValue) - 1 : 0;
    subPeriods.push({ from: cursorDate, to: last.date, r });
  }

  // 4. TWR = producto de (1+r_i) - 1
  let twr = 1;
  for (const sp of subPeriods) twr *= (1 + sp.r);
  twr -= 1;

  const aportesClp = movs.filter((m) => m.type === 'aporte').reduce((s, m) => s + Number(m.amount_clp), 0);
  const retirosClp = movs.filter((m) => m.type === 'retiro').reduce((s, m) => s + Number(m.amount_clp), 0);

  // TWR_clp aproximado: aplicar el TWR al valor inicial
  const twrClpAprox = snapshots[0].total_clp * twr;

  return {
    from: snapshots[0].date,
    to: last.date,
    twr_pct: twr * 100,
    twr_clp_aprox: twrClpAprox,
    valor_inicial_clp: snapshots[0].total_clp,
    valor_final_clp: last.total_clp,
    aportes_clp: aportesClp,
    retiros_clp: retirosClp,
    aportes_netos_clp: aportesClp - retirosClp,
    n_sub_periodos: subPeriods.length,
  };
}

/** Resumen mensual: por cada mes del rango, % y CLP real (descontando aportes). */
export async function getMonthlyRentabilidad(userId, from, to) {
  const snaps = await getSnapshots(userId, from, to);
  if (snaps.length === 0) return [];

  // Agrupar por mes (YYYY-MM): primer y último snapshot del mes
  const byMonth = new Map();
  for (const s of snaps) {
    const ym = s.date.slice(0, 7);
    const cur = byMonth.get(ym) || { first: s, last: s };
    if (s.date < cur.first.date) cur.first = s;
    if (s.date > cur.last.date) cur.last = s;
    byMonth.set(ym, cur);
  }

  const result = [];
  for (const [ym, { first, last }] of [...byMonth.entries()].sort()) {
    // Rango del mes [primer día, último día] calculado de forma segura.
    const [y, m] = ym.split('-').map(Number);
    const monthStart = `${ym}-01`;
    const monthEnd = toISODate(new Date(y, m, 0)); // día 0 del mes siguiente = último del actual
    const { neto } = await netAportes(userId, monthStart, monthEnd);
    const vi = first.total_clp;
    const vf = last.total_clp;
    const base = vi + neto;
    const rentClp = vf - vi - neto;          // rentabilidad real (sin aportes)
    const rentPct = base > 0 ? (rentClp / base) * 100 : null;
    result.push({
      mes: ym,
      rentabilidad_pct: rentPct,
      rentabilidad_clp: rentClp,
      valor_inicial_clp: vi,
      valor_final_clp: vf,
      aportes_netos_clp: neto,
    });
  }
  return result;
}
