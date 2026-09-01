import { isHidden, maskDigits } from './privacy.js';

// Formateadores de moneda y porcentaje según las reglas del proyecto.
//   CLP -> formato chileno:  $24.866.305
//   USD -> formato americano: $24,866.31
//   %   -> 2 decimales:       2,10%

/** CLP sin decimales, separador de miles con punto. */
export function formatCLP(value, { sign = false } = {}) {
  if (value == null || Number.isNaN(value)) return '—';
  const n = Math.round(Number(value));
  const formatted = new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(Math.abs(n));
  const prefix = n < 0 ? '-' : sign ? '+' : '';
  return isHidden() ? maskDigits(`${prefix}${formatted}`) : `${prefix}${formatted}`;
}

/** USD con 2 decimales, formato americano. */
export function formatUSD(value, { sign = false } = {}) {
  if (value == null || Number.isNaN(value)) return '—';
  const n = Number(value);
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(n));
  const prefix = n < 0 ? '-' : sign ? '+' : '';
  return isHidden() ? maskDigits(`${prefix}${formatted}`) : `${prefix}${formatted}`;
}

/**
 * Porcentaje con 2 decimales y coma decimal (es-CL). Ej: 2,10%
 * El modo privado NO lo oculta: un % no revela patrimonio, y dejarlo visible
 * mantiene la app útil con los montos tapados.
 */
export function formatPct(value, { sign = true } = {}) {
  if (value == null || Number.isNaN(value)) return '—';
  const n = Number(value);
  const formatted = new Intl.NumberFormat('es-CL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(n));
  const prefix = n < 0 ? '-' : sign ? '+' : '';
  return `${prefix}${formatted}%`;
}

/** Número genérico (unidades/cuotas) con hasta 4 decimales. */
export function formatUnits(value) {
  if (value == null || Number.isNaN(value)) return '—';
  const out = new Intl.NumberFormat('es-CL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(Number(value));
  return isHidden() ? maskDigits(out) : out;
}

/** Clase de color tailwind según signo (verde +, rojo -). */
export function colorForValue(value) {
  if (value == null || Number.isNaN(value) || Number(value) === 0) return 'text-muted';
  return Number(value) > 0 ? 'text-gain' : 'text-loss';
}

/** Etiqueta legible para tipo de instrumento. */
export const TYPE_LABELS = {
  stock_us: 'Acción USA',
  stock_cl: 'Acción Chile',
  crypto: 'Crypto',
  fondo_mutuo_cl: 'Fondo CLP',
  afp: 'AFP / APV',
};

// --- Agrupación de alto nivel para la vista de Posiciones ---
export const CATEGORY_LABELS = {
  acciones_cl: 'Acciones Chile',
  acciones_us: 'Acciones USA',
  fondos_cl: 'Fondos Chile',
  fondos_us: 'Fondos USA',
  crypto: 'Criptomonedas',
};

// Orden de despliegue de las categorías
export const CATEGORY_ORDER = ['acciones_cl', 'acciones_us', 'fondos_cl', 'fondos_us', 'crypto'];

/** Mapea un instrumento (por su `type`) a una categoría de alto nivel. */
export function categoryOf(type) {
  switch (type) {
    case 'stock_cl': return 'acciones_cl';
    case 'stock_us': return 'acciones_us';
    case 'crypto': return 'crypto';
    case 'fondo_mutuo_cl': return 'fondos_cl'; // todos los fondos -> Chile
    case 'afp': return 'fondos_cl';            // APV agrupado con Fondos Chile
    default: return 'fondos_cl';
  }
}

/** Fecha YYYY-MM-DD -> DD-MM-YYYY */
export function formatDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

/** Timestamp ISO -> "DD-MM-YYYY HH:MM", en hora local. */
export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p2 = (n) => String(n).padStart(2, '0');
  return `${p2(d.getDate())}-${p2(d.getMonth() + 1)}-${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
