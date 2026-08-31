// Calendario de mercado: decide para qué fechas TIENE SENTIDO pedir un precio.
//
// Es la pieza que hay que tener antes de cualquier fallback "inteligente". Sin
// ella, los cuatro casos siguientes se ven todos iguales:
//
//   - el dato todavía no se publicó   (valor cuota CMF, 1-2 días hábiles)
//   - el dato no existe para ese día  (feriado, fin de semana)
//   - la fuente falló                 (CMF caído, 429 de Yahoo)
//   - el activo no tiene fuente       (los FIP sin API pública)
//
// Y si se le pide a un modelo el valor cuota de un día en que todavía no se
// publicó, va a devolver un número, y va a estar mal. Un número inventado que se
// ve idéntico a uno oficial es peor que un hueco marcado.

import { query } from '../config/db.js';
import { addDays, isWeekend } from '../utils/dates.js';

/** A qué mercado pertenece cada tipo de instrumento. */
export function marketOf(type) {
  switch (type) {
    case 'stock_us':       return 'US';
    case 'crypto':         return 'CRYPTO';
    case 'stock_cl':
    case 'fondo_mutuo_cl':
    case 'afp':
    default:               return 'CL';
  }
}

/**
 * Días hábiles de rezago con que publica cada tipo.
 *
 * Los fondos mutuos chilenos publican el valor cuota con uno o dos días hábiles
 * de atraso; las AFP igual. Pedirles el precio de hoy a las 8:30 AM no es un
 * error de la fuente, es que el dato no existe todavía.
 *
 * `fondosCmfFetcher` ya lo compensaba pidiendo una ventana de 10 días y tomando
 * la fila más reciente; acá queda explícito para todos.
 */
export function expectedLagDays(type) {
  switch (type) {
    case 'fondo_mutuo_cl': return 2;
    case 'afp':            return 2;
    case 'crypto':         return 0;
    default:               return 0;   // acciones: cierre del mismo día
  }
}

/** Feriados cacheados por mercado. La tabla cambia una vez al año. */
const holidayCache = new Map();

async function holidaysFor(market) {
  if (holidayCache.has(market)) return holidayCache.get(market);
  const { rows } = await query(
    'SELECT date FROM market_holidays WHERE market = $1',
    [market]
  );
  const set = new Set(rows.map((r) => (typeof r.date === 'string'
    ? r.date.slice(0, 10)
    : r.date.toISOString().slice(0, 10))));
  holidayCache.set(market, set);
  return set;
}

/** Vacía el cache de feriados (después de cargar feriados nuevos). */
export function clearHolidayCache() { holidayCache.clear(); }

/**
 * ¿Ese mercado opera esa fecha?
 * Crypto opera siempre; el resto, días hábiles que no sean feriado.
 */
export async function isTradingDay(market, iso) {
  if (market === 'CRYPTO') return true;
  if (isWeekend(iso)) return false;
  return !(await holidaysFor(market)).has(iso);
}

/**
 * La fecha más reciente para la que ya debería existir precio.
 *
 * Retrocede desde hoy tantos días hábiles como diga el rezago del tipo, y
 * después sigue retrocediendo mientras caiga en un día no hábil.
 */
export async function lastExpectedDate(type, today) {
  const market = marketOf(type);
  let d = today;
  let restan = expectedLagDays(type);

  // Primero consumir el rezago, contando solo días hábiles.
  while (restan > 0) {
    d = addDays(d, -1);
    if (await isTradingDay(market, d)) restan -= 1;
  }
  // Después, si cayó en fin de semana o feriado, seguir hacia atrás.
  let guard = 0;
  while (!(await isTradingDay(market, d)) && guard < 30) {
    d = addDays(d, -1);
    guard += 1;
  }
  return d;
}

/**
 * Los días hábiles sin precio fresco de un instrumento, mirando hacia atrás.
 * Delega en price_gaps() para no traer el historial completo a JS.
 */
export async function gapsFor(instrumentId, type, today, lookbackDays = 15) {
  const until = await lastExpectedDate(type, today);
  const since = addDays(until, -lookbackDays);
  const { rows } = await query(
    'SELECT date FROM price_gaps($1, $2, $3, $4)',
    [instrumentId, marketOf(type), since, until]
  );
  return rows.map((r) => (typeof r.date === 'string'
    ? r.date.slice(0, 10)
    : r.date.toISOString().slice(0, 10)));
}
