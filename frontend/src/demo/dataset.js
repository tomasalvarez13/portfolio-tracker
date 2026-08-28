// Dataset sintético del modo demo.
//
// Todo sale de un PRNG con semilla fija: los mismos números en cada carga, y nada
// derivado de la cuenta real. Se genera hacia adelante en el tiempo (precios →
// aportes → unidades → snapshots) para que resumen, posiciones, movimientos,
// rentabilidad y TWR cuadren entre sí igual que lo harían contra el backend.

import { DEMO_USER } from './mode.js';

const SEED   = 20260731;
const N_DAYS = 300;          // ~14 meses hábiles de historia

// ── PRNG determinista ─────────────────────────────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rnd) {
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ── Fechas ────────────────────────────────────────────────────────────────────
const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function businessDays(n) {
  const out = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  while (out.length < n) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) out.push(new Date(d));
    d.setDate(d.getDate() - 1);
  }
  return out.reverse();
}

// ── Instrumentos del demo ─────────────────────────────────────────────────────
// Ninguno coincide con la cartera real. p0 = precio inicial en su moneda nativa,
// drift = retorno anual esperado, vol = volatilidad diaria.
const DEF = [
  { id: 1,  name: 'Apple Inc.',                 ticker: 'AAPL',         type: 'stock_us',       currency: 'USD', api_source: 'yahoo_finance', p0: 212,   drift: 0.14,  vol: 0.0185, w: 0.09 },
  { id: 2,  name: 'NVIDIA Corp',                ticker: 'NVDA',         type: 'stock_us',       currency: 'USD', api_source: 'yahoo_finance', p0: 128,   drift: 0.30,  vol: 0.0310, w: 0.07 },
  { id: 3,  name: 'Vanguard S&P 500 ETF',       ticker: 'VOO',          type: 'stock_us',       currency: 'USD', api_source: 'yahoo_finance', p0: 505,   drift: 0.11,  vol: 0.0105, w: 0.14 },
  { id: 4,  name: 'Invesco QQQ Trust',          ticker: 'QQQ',          type: 'stock_us',       currency: 'USD', api_source: 'yahoo_finance', p0: 448,   drift: 0.15,  vol: 0.0140, w: 0.08 },
  { id: 5,  name: 'Bitcoin',                    ticker: 'BTC',          type: 'crypto',         currency: 'USD', api_source: 'coingecko',     p0: 61000, drift: 0.36,  vol: 0.0355, w: 0.06 },
  { id: 6,  name: 'S.A.C.I. Falabella',         ticker: 'FALABELLA.SN', type: 'stock_cl',       currency: 'CLP', api_source: 'yahoo_finance', p0: 3180,  drift: 0.09,  vol: 0.0160, w: 0.05 },
  { id: 7,  name: 'Cencosud S.A.',              ticker: 'CENCOSUD.SN',  type: 'stock_cl',       currency: 'CLP', api_source: 'yahoo_finance', p0: 1845,  drift: 0.07,  vol: 0.0170, w: 0.04 },
  { id: 8,  name: 'Banco de Chile',             ticker: 'CHILE.SN',     type: 'stock_cl',       currency: 'CLP', api_source: 'yahoo_finance', p0: 112,   drift: 0.10,  vol: 0.0130, w: 0.05 },
  { id: 9,  name: 'FM Security Balanceado',     ticker: null,           type: 'fondo_mutuo_cl', currency: 'CLP', api_source: 'cmf',           p0: 2465,  drift: 0.080, vol: 0.0050, w: 0.16 },
  { id: 10, name: 'FM BICE Deuda Corto Plazo',  ticker: null,           type: 'fondo_mutuo_cl', currency: 'CLP', api_source: 'cmf',           p0: 1720,  drift: 0.052, vol: 0.0012, w: 0.12 },
  { id: 11, name: 'APV Habitat Fondo C',        ticker: null,           type: 'afp',            currency: 'CLP', api_source: 'sp',            p0: 62480, drift: 0.065, vol: 0.0040, w: 0.14 },
];

const META = {
  9:  { serie: 'A', admin: '76200000' },
  10: { serie: 'A', admin: '76200001' },
  11: { tipo_fondo: 'C', afp: 'HABITAT' },
};

// Multiplicador global de montos. Escala patrimonio, aportes y retiros por igual,
// así que porcentajes, rentabilidad y forma del gráfico no cambian: solo los ceros.
const SCALE     = 10;
const START_CLP = 6_800_000 * SCALE;   // patrimonio al inicio de la serie

// ── Generación ────────────────────────────────────────────────────────────────
function build() {
  const dateObjs = businessDays(N_DAYS);
  const dates    = dateObjs.map(iso);
  const T        = dates.length;

  // Dólar observado
  const rndFx = mulberry32(SEED);
  const fx = new Array(T);
  fx[0] = 905;
  for (let t = 1; t < T; t++) {
    fx[t] = fx[t - 1] * Math.exp(0.03 / 252 - 0.5 * 0.006 ** 2 + 0.006 * gaussian(rndFx));
  }

  // Precios por instrumento, en su moneda nativa
  const native = {};
  for (const d of DEF) {
    const rnd = mulberry32(SEED + d.id * 7919);
    const p = new Array(T);
    p[0] = d.p0;
    for (let t = 1; t < T; t++) {
      p[t] = p[t - 1] * Math.exp(d.drift / 252 - 0.5 * d.vol ** 2 + d.vol * gaussian(rnd));
    }
    native[d.id] = p;
  }

  const priceClp = {}, priceUsd = {};
  for (const d of DEF) {
    priceClp[d.id] = native[d.id].map((p, t) => (d.currency === 'USD' ? p * fx[t] : p));
    priceUsd[d.id] = native[d.id].map((p, t) => (d.currency === 'USD' ? p : p / fx[t]));
  }

  // Unidades día a día + movimientos (aporte mensual y un retiro)
  const units = {};
  for (const d of DEF) units[d.id] = (START_CLP * d.w) / priceClp[d.id][0];

  const rndMov    = mulberry32(SEED + 13);
  const movements = [];
  const unitsByDay = [];
  const aporteDone = new Set();
  const retiroT    = Math.floor(T * 0.62);
  let movId = 1;

  for (let t = 0; t < T; t++) {
    const ym = dates[t].slice(0, 7);

    if (t > 0 && !aporteDone.has(ym) && dateObjs[t].getDate() >= 5) {
      aporteDone.add(ym);
      const amount = Math.round((200_000 + rndMov() * 450_000) * SCALE / 10_000) * 10_000;
      movements.push({
        id: movId++, user_id: DEMO_USER.id, instrument_id: null,
        date: dates[t], type: 'aporte', amount_clp: amount, amount_usd: null,
        notes: 'Aporte mensual', created_at: `${dates[t]}T12:00:00.000Z`,
        instrument_name: null, instrument_type: null,
      });
      for (const d of DEF) units[d.id] += (amount * d.w) / priceClp[d.id][t];
    }

    if (t === retiroT) {
      const amount = 380_000 * SCALE;
      movements.push({
        id: movId++, user_id: DEMO_USER.id, instrument_id: null,
        date: dates[t], type: 'retiro', amount_clp: amount, amount_usd: null,
        notes: 'Retiro parcial', created_at: `${dates[t]}T12:00:00.000Z`,
        instrument_name: null, instrument_type: null,
      });
      const total = DEF.reduce((s, d) => s + units[d.id] * priceClp[d.id][t], 0);
      const k = (total - amount) / total;
      for (const d of DEF) units[d.id] *= k;
    }

    unitsByDay.push({ ...units });
  }

  const instruments = DEF.map((d) => ({
    id: d.id, name: d.name, alias: null, type: d.type, ticker: d.ticker,
    currency: d.currency, api_source: d.api_source,
    external_id: d.ticker ?? String(9000 + d.id),
    meta: META[d.id] ?? {},
    created_at: `${dates[0]}T12:00:00.000Z`,
  }));

  const state = {
    dates, fx, instruments, priceClp, priceUsd,
    units: { ...unitsByDay[T - 1] },
    unitsByDay, movements,
    snapshots: [],
    nextMovementId: movId,
    nextInstrumentId: DEF.length + 1,
  };

  state.snapshots = dates.map((date, t) => snapshotAt(state, t, unitsByDay[t]));
  return state;
}

/** Valoriza un set de unidades a los precios del día t. */
export function snapshotAt(state, t, units) {
  const breakdown = {};
  let total_clp = 0, total_usd = 0;
  for (const inst of state.instruments) {
    const u = units[inst.id];
    if (u == null) continue;
    const vc = u * state.priceClp[inst.id][t];
    const vu = u * state.priceUsd[inst.id][t];
    total_clp += vc; total_usd += vu;
    if (!breakdown[inst.type]) breakdown[inst.type] = { clp: 0, usd: 0 };
    breakdown[inst.type].clp += vc;
    breakdown[inst.type].usd += vu;
  }
  return { date: state.dates[t], total_clp, total_usd, breakdown };
}

/** Recalcula el snapshot de hoy tras una escritura del usuario en el demo. */
export function recomputeToday(state) {
  const t = state.dates.length - 1;
  state.snapshots[t] = snapshotAt(state, t, state.units);
}

let cached = null;
export function getState() {
  if (!cached) cached = build();
  return cached;
}
