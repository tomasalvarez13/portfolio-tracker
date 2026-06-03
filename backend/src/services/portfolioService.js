// Lógica de portafolio: valorización de posiciones, snapshots diarios,
// resumen del día y cálculo de rentabilidad (total y sobre lo invertido).

import { query } from '../config/db.js';

const todayISO = () => new Date().toISOString().slice(0, 10);

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
            i.id AS instrument_id, i.name, i.alias, i.type, i.ticker, i.currency, i.api_source,
            lp.price_clp, lp.price_usd, lp.date AS price_date, lp.is_stale
     FROM positions p
     JOIN instruments i ON i.id = p.instrument_id
     LEFT JOIN latest_prices lp ON lp.instrument_id = i.id
     WHERE p.user_id = $1
     ORDER BY i.type, i.name`,
    [userId]
  );

  let totalClp = 0;
  let totalUsd = 0;
  let latestPriceDate = null;

  const positions = rows.map((r) => {
    let valueClp = null;
    let valueUsd = null;

    if (r.units != null) {
      // Valorizar por unidades × precio
      const pClp = r.price_clp != null ? Number(r.price_clp) : null;
      const pUsd = r.price_usd != null ? Number(r.price_usd) : null;
      if (pClp != null) valueClp = Number(r.units) * pClp;
      if (pUsd != null) valueUsd = Number(r.units) * pUsd;
      // Completar la moneda faltante con el dólar
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

/**
 * Calcula y guarda el snapshot del patrimonio total del usuario para una fecha.
 * @returns {Promise<{date:string, total_clp:number, total_usd:number, breakdown:object}>}
 */
export async function computeAndSaveSnapshot(userId, date = todayISO()) {
  const { positions, totalClp, totalUsd } = await computePositions(userId);

  const breakdown = {};
  for (const p of positions) {
    if (!breakdown[p.type]) breakdown[p.type] = { clp: 0, usd: 0 };
    breakdown[p.type].clp += p.value_clp || 0;
    breakdown[p.type].usd += p.value_usd || 0;
  }

  await query(
    `INSERT INTO portfolio_snapshots (user_id, date, total_clp, total_usd, breakdown)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, date)
     DO UPDATE SET total_clp = EXCLUDED.total_clp,
                   total_usd = EXCLUDED.total_usd,
                   breakdown = EXCLUDED.breakdown`,
    [userId, date, totalClp, totalUsd, JSON.stringify(breakdown)]
  );

  return { date, total_clp: totalClp, total_usd: totalUsd, breakdown };
}

/** Genera snapshots del día para TODOS los usuarios (lo llama el cron). */
export async function snapshotAllUsers(date = todayISO()) {
  const { rows } = await query(`SELECT id FROM users`);
  const results = [];
  for (const u of rows) {
    try {
      const snap = await computeAndSaveSnapshot(u.id, date);
      results.push({ user: u.id, ok: true, total_clp: snap.total_clp });
    } catch (e) {
      console.error(`[portfolioService] snapshot falló para ${u.id}: ${e.message}`);
      results.push({ user: u.id, ok: false, error: e.message });
    }
  }
  return results;
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
  const today = todayISO();
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
    `SELECT date, total_clp, total_usd, breakdown FROM portfolio_snapshots
     WHERE ${clauses.join(' AND ')} ORDER BY date ASC`,
    params
  );
  return rows.map((r) => ({
    date: toISODate(r.date),
    total_clp: Number(r.total_clp),
    total_usd: Number(r.total_usd),
    breakdown: r.breakdown,
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
