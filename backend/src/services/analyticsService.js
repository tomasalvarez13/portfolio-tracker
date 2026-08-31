// Rentabilidad por custodio y por activo.
//
// ─── De dónde salen los flujos ────────────────────────────────────────────────
//
// El TWR necesita separar lo que entró y salió de plata de lo que se movió por
// precio. A nivel portafolio eso sale de `movements`, porque el usuario los
// registra. Por bucket no alcanza: si alguien solo sube cartolas y nunca anota
// un aporte, cada saldo nuevo mezcla las dos cosas y todo el cambio parecería
// rentabilidad.
//
// La salida es que **el precio mueve el valor, no las unidades**. Entre dos
// días, un cambio de unidades solo puede venir de un aporte, un retiro, una
// compra o una venta. Así que el flujo se deriva:
//
//     flujo(D) = (unidades(D) − unidades(D−1)) × precio(D)
//
// Eso se calcula desde `position_snapshots` sin depender de que el usuario haya
// registrado nada, y funciona igual si la posición entró por cartola o a mano.
//
// La excepción son las posiciones cargadas por MONTO en vez de unidades: ahí un
// cambio de valor puede ser precio o aporte, y no hay forma de saberlo. Esos
// buckets se marcan con `flujos_estimados: false` y su TWR se devuelve en null
// en vez de inventar un número.

import { query } from '../config/db.js';
import { toISODate } from '../utils/dates.js';

/**
 * TWR sobre una serie de puntos.
 *
 * Cada punto es { date, value, flow }, donde `flow` es la plata que entró (+) o
 * salió (−) ESE día. El sub-período va del cierre anterior al cierre actual, y
 * el flujo se descuenta del valor final: lo que entró hoy no es rentabilidad.
 *
 *     r_i = (V_i − F_i) / V_{i−1} − 1
 *     TWR = Π (1 + r_i) − 1
 *
 * Función pura: no toca la base. La usan los tres niveles —portafolio, custodio
 * y activo— así que la lógica del cálculo existe una sola vez.
 *
 * @param {{date:string, value:number, flow:number}[]} puntos  ordenados por fecha
 */
export function computeTWRFromSeries(puntos) {
  const serie = (puntos || []).filter((p) => p && p.value != null);
  if (serie.length < 2) {
    return { twr_pct: null, sub_periodos: 0, error: 'Serie insuficiente' };
  }

  let twr = 1;
  let usados = 0;
  let saltados = 0;

  for (let i = 1; i < serie.length; i++) {
    const vPrev = Number(serie[i - 1].value);
    const vAct  = Number(serie[i].value);
    const flujo = Number(serie[i].flow || 0);

    // Con valor inicial cero no hay retorno que medir: es el día en que la
    // posición nace. Se salta el sub-período en vez de dividir por cero.
    if (!(vPrev > 0)) { saltados++; continue; }

    twr *= 1 + ((vAct - flujo) / vPrev - 1);
    usados++;
  }

  return {
    twr_pct: usados > 0 ? (twr - 1) * 100 : null,
    sub_periodos: usados,
    sub_periodos_saltados: saltados,
    valor_inicial: Number(serie[0].value),
    valor_final: Number(serie[serie.length - 1].value),
  };
}

/**
 * Trae los snapshots por (custodio, activo) y fecha, que es el grano más fino
 * donde las unidades son comparables entre sí.
 */
async function rawSeries(userId, from, to) {
  const { rows } = await query(
    `SELECT ps.date, ps.custodian_id, ps.instrument_id,
            ps.units, ps.price_clp, ps.value_clp, ps.value_usd, ps.is_stale,
            i.name AS instrument_name, i.alias, i.type, i.ticker,
            c.name AS custodian_name
     FROM position_snapshots ps
     JOIN instruments i ON i.id = ps.instrument_id
     JOIN custodians  c ON c.id = ps.custodian_id
     WHERE ps.user_id = $1 AND ps.date >= $2 AND ps.date <= $3
     ORDER BY ps.custodian_id, ps.instrument_id, ps.date`,
    [userId, from, to]
  );
  return rows.map((r) => ({ ...r, date: toISODate(r.date) }));
}

/**
 * Agrupa por bucket y arma, para cada fecha, el valor total y el flujo derivado.
 *
 * El flujo se calcula al grano (custodio, activo) —donde las unidades son
 * comparables— y recién después se suma al nivel del bucket. Sumar unidades de
 * activos distintos no significaría nada.
 */
function buildBuckets(rows, keyFn, labelFn) {
  // Flujo por (custodio, activo, fecha).
  const porPosicion = new Map();
  for (const r of rows) {
    const k = `${r.custodian_id}/${r.instrument_id}`;
    if (!porPosicion.has(k)) porPosicion.set(k, []);
    porPosicion.get(k).push(r);
  }

  const flujoPorFecha = new Map();   // `${bucket}|${date}` -> flujo
  const bucketEstimable = new Map(); // bucket -> bool

  for (const serie of porPosicion.values()) {
    for (let i = 0; i < serie.length; i++) {
      const r = serie[i];
      const bucket = keyFn(r);
      const prev = serie[i - 1];

      // Sin unidades no se puede separar precio de aporte.
      const estimable = r.units != null && (i === 0 || prev.units != null);
      if (!bucketEstimable.has(bucket)) bucketEstimable.set(bucket, true);
      if (!estimable) bucketEstimable.set(bucket, false);

      let flujo = 0;
      if (i === 0) {
        // El primer día de la serie no es un aporte: es el punto de partida.
        flujo = 0;
      } else if (estimable) {
        const dU = Number(r.units) - Number(prev.units);
        // El precio del día es el que corresponde: el flujo se valoriza a lo
        // que costaba cuando ocurrió.
        const precio = r.price_clp != null ? Number(r.price_clp)
          : (Number(r.units) !== 0 ? Number(r.value_clp) / Number(r.units) : 0);
        flujo = dU * precio;
      }

      const fk = `${bucket}|${r.date}`;
      flujoPorFecha.set(fk, (flujoPorFecha.get(fk) || 0) + flujo);
    }
  }

  // Valor por bucket y fecha.
  const buckets = new Map();
  for (const r of rows) {
    const bucket = keyFn(r);
    if (!buckets.has(bucket)) {
      buckets.set(bucket, { key: bucket, label: labelFn(r), meta: r, porFecha: new Map() });
    }
    const b = buckets.get(bucket);
    const cur = b.porFecha.get(r.date) || { date: r.date, value: 0, value_usd: 0, stale: 0, n: 0 };
    cur.value     += Number(r.value_clp || 0);
    cur.value_usd += Number(r.value_usd || 0);
    cur.stale     += r.is_stale ? 1 : 0;
    cur.n         += 1;
    b.porFecha.set(r.date, cur);
  }

  return [...buckets.values()].map((b) => {
    const serie = [...b.porFecha.values()]
      .sort((a, z) => (a.date < z.date ? -1 : 1))
      .map((p) => ({ ...p, flow: flujoPorFecha.get(`${b.key}|${p.date}`) || 0 }));

    const twr = computeTWRFromSeries(serie);
    const aportes = serie.reduce((s, p) => s + (p.flow > 0 ? p.flow : 0), 0);
    const retiros = serie.reduce((s, p) => s + (p.flow < 0 ? -p.flow : 0), 0);
    const estimable = bucketEstimable.get(b.key) !== false;

    return {
      key: b.key,
      label: b.label,
      meta: b.meta,
      valor_inicial_clp: twr.valor_inicial ?? null,
      valor_final_clp:   twr.valor_final ?? null,
      valor_final_usd:   serie[serie.length - 1]?.value_usd ?? null,
      aportes_clp: aportes,
      retiros_clp: retiros,
      // Sin flujos estimables el TWR sería un número inventado: mejor null y
      // que la UI lo diga.
      twr_pct: estimable ? twr.twr_pct : null,
      flujos_estimados: estimable,
      // Cuántos puntos de la serie se valorizaron con un precio de
      // carry-forward, para poder marcar el dato.
      dias_stale: serie.filter((p) => p.stale > 0).length,
      dias: serie.length,
      serie: serie.map((p) => ({ date: p.date, value_clp: p.value, flow_clp: p.flow })),
    };
  }).sort((a, b) => (b.valor_final_clp ?? 0) - (a.valor_final_clp ?? 0));
}

/** Rentabilidad agrupada por custodio. */
export async function byCustodian(userId, from, to) {
  const rows = await rawSeries(userId, from, to);
  if (rows.length === 0) return { from, to, buckets: [], total_final_clp: 0 };

  const buckets = buildBuckets(
    rows,
    (r) => `c${r.custodian_id}`,
    (r) => r.custodian_name
  );
  return {
    from, to, buckets,
    total_final_clp: buckets.reduce((s, b) => s + (b.valor_final_clp || 0), 0),
  };
}

/** Rentabilidad agrupada por activo. */
export async function byInstrument(userId, from, to) {
  const rows = await rawSeries(userId, from, to);
  if (rows.length === 0) return { from, to, buckets: [], total_final_clp: 0 };

  const buckets = buildBuckets(
    rows,
    (r) => `i${r.instrument_id}`,
    (r) => r.alias || r.instrument_name
  ).map((b) => ({
    ...b,
    type:   b.meta.type,
    ticker: b.meta.ticker,
    meta:   undefined,
  }));

  return {
    from, to, buckets,
    total_final_clp: buckets.reduce((s, b) => s + (b.valor_final_clp || 0), 0),
  };
}

/** El rango con datos que hay disponible, para que la UI no pida vacío. */
export async function availableRange(userId) {
  const { rows } = await query(
    `SELECT min(date) AS desde, max(date) AS hasta, count(DISTINCT date)::int AS dias
     FROM position_snapshots WHERE user_id = $1`,
    [userId]
  );
  return {
    desde: toISODate(rows[0]?.desde),
    hasta: toISODate(rows[0]?.hasta),
    dias: rows[0]?.dias || 0,
  };
}
