// Backend falso del modo demo: replica los endpoints de la API Express contra el
// dataset sintético, incluidas las escrituras (viven en memoria, mueren al recargar).
// Las fórmulas de rentabilidad y TWR son las mismas de portfolioService.js para que
// los números del demo cuadren igual que en la app real.

import { getState, recomputeToday } from './dataset.js';
import { DEMO_USER } from './mode.js';

const lastT = (s) => s.dates.length - 1;
const todayISO = (s) => s.dates[lastT(s)];

// El demo no modela custodios reales: expone la lista para que el selector del
// form tenga qué mostrar, y todas las posiciones caen en el centinela.
const DEMO_CUSTODIANS = [
  { id: 0, slug: 'sin-custodio', name: 'Sin custodio', country: 'CL' },
  { id: 1, slug: 'fintual',      name: 'Fintual',      country: 'CL' },
  { id: 2, slug: 'racional',     name: 'Racional',     country: 'CL' },
  { id: 3, slug: 'banchile',     name: 'Banchile Inversiones', country: 'CL' },
  { id: 4, slug: 'buda',         name: 'Buda.com',     country: 'CL' },
];

// ── Lecturas derivadas ────────────────────────────────────────────────────────
function buildPositions(s) {
  const t = lastT(s);
  const positions = [];
  let totalClp = 0, totalUsd = 0;

  for (const inst of s.instruments) {
    const u = s.units[inst.id];
    if (u == null) continue;
    const price_clp = s.priceClp[inst.id][t];
    const price_usd = s.priceUsd[inst.id][t];
    const value_clp = u * price_clp;
    const value_usd = u * price_usd;
    totalClp += value_clp;
    totalUsd += value_usd;
    positions.push({
      id: 1000 + inst.id, instrument_id: inst.id,
      custodian_id: 0, custodian_name: 'Sin custodio',
      name: inst.name, alias: inst.alias, type: inst.type, ticker: inst.ticker,
      currency: inst.currency, api_source: inst.api_source,
      units: u, amount_clp: null, amount_usd: null,
      price_clp, price_usd, price_date: s.dates[t], is_stale: false,
      value_clp, value_usd, notes: null,
    });
  }
  for (const p of positions) {
    p.pct_portfolio = totalClp > 0 ? (p.value_clp / totalClp) * 100 : 0;
  }
  positions.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  return { positions, totalClp, totalUsd, priceDate: s.dates[t] };
}

function summary(s) {
  const { totalClp, totalUsd, priceDate } = buildPositions(s);
  const prev = s.snapshots[s.snapshots.length - 2] || null;
  let change_clp = null, change_pct = null;
  if (prev) {
    change_clp = totalClp - prev.total_clp;
    change_pct = prev.total_clp > 0 ? (change_clp / prev.total_clp) * 100 : null;
  }
  return {
    total_clp: totalClp, total_usd: totalUsd, price_date: priceDate,
    change_clp, change_pct, prev_date: prev?.date ?? null,
  };
}

function snapshots(s, from, to) {
  return s.snapshots.filter((x) => (!from || x.date >= from) && (!to || x.date <= to));
}

function breakdown(s) {
  const last = s.snapshots[s.snapshots.length - 1];
  const out = Object.entries(last.breakdown).map(([type, v]) => ({
    type, total_clp: v.clp, total_usd: v.usd,
    pct: last.total_clp > 0 ? (v.clp / last.total_clp) * 100 : 0,
  }));
  out.sort((a, b) => b.total_clp - a.total_clp);
  return out;
}

function valueAt(s, date) {
  let best = null;
  for (const x of s.snapshots) {
    if (x.date <= date) best = x; else break;
  }
  return best ? { date: best.date, total_clp: best.total_clp } : null;
}

function netAportes(s, from, to) {
  let aportes = 0, retiros = 0;
  for (const m of s.movements) {
    if (m.date < from || m.date > to) continue;
    if (m.type === 'aporte') aportes += Number(m.amount_clp || 0);
    else retiros += Number(m.amount_clp || 0);
  }
  return { aportes, retiros, neto: aportes - retiros };
}

function rentabilidad(s, from, to) {
  const vi = valueAt(s, from), vf = valueAt(s, to);
  if (!vi || !vf) {
    return {
      error: 'Sin snapshots suficientes en el rango',
      valor_inicial_clp: vi?.total_clp ?? null, valor_final_clp: vf?.total_clp ?? null,
    };
  }
  const { aportes, retiros, neto } = netAportes(s, from, to);
  const rentTotalClp = vf.total_clp - vi.total_clp;
  const base = vi.total_clp + neto;
  const rentInvClp = vf.total_clp - vi.total_clp - neto;
  return {
    from: vi.date, to: vf.date,
    valor_inicial_clp: vi.total_clp, valor_final_clp: vf.total_clp,
    aportes_periodo_clp: aportes, retiros_periodo_clp: retiros, aportes_netos_clp: neto,
    rentabilidad_total_clp: rentTotalClp,
    rentabilidad_total_pct: vi.total_clp > 0 ? (rentTotalClp / vi.total_clp) * 100 : null,
    rentabilidad_sobre_invertido_clp: rentInvClp,
    rentabilidad_sobre_invertido_pct: base > 0 ? (rentInvClp / base) * 100 : null,
  };
}

function monthlyRentabilidad(s, from, to) {
  const snaps = snapshots(s, from, to);
  if (!snaps.length) return [];
  const byMonth = new Map();
  for (const x of snaps) {
    const ym = x.date.slice(0, 7);
    const cur = byMonth.get(ym) || { first: x, last: x };
    if (x.date < cur.first.date) cur.first = x;
    if (x.date > cur.last.date) cur.last = x;
    byMonth.set(ym, cur);
  }
  return [...byMonth.entries()].sort().map(([ym, { first, last }]) => {
    const [y, m] = ym.split('-').map(Number);
    const monthEnd = new Date(y, m, 0);
    const { neto } = netAportes(
      s, `${ym}-01`,
      `${monthEnd.getFullYear()}-${String(monthEnd.getMonth() + 1).padStart(2, '0')}-${String(monthEnd.getDate()).padStart(2, '0')}`
    );
    const base = first.total_clp + neto;
    const rentClp = last.total_clp - first.total_clp - neto;
    return {
      mes: ym,
      rentabilidad_pct: base > 0 ? (rentClp / base) * 100 : null,
      rentabilidad_clp: rentClp,
      valor_inicial_clp: first.total_clp,
      valor_final_clp: last.total_clp,
      aportes_netos_clp: neto,
    };
  });
}

function twr(s, from, to) {
  const snaps = snapshots(s, from, to);
  if (snaps.length < 2) return { twr_pct: null, error: 'No hay suficientes snapshots en el rango' };

  const movs = s.movements
    .filter((m) => m.instrument_id == null && m.date > from && m.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date));

  const snapBefore = (date) => {
    let best = null;
    for (const x of snaps) { if (x.date < date) best = x; else break; }
    return best;
  };

  const subPeriods = [];
  let cursorValue = snaps[0].total_clp;
  let cursorDate  = snaps[0].date;

  for (const m of movs) {
    const before = snapBefore(m.date);
    if (!before || before.date < cursorDate) continue;
    const r = cursorValue > 0 ? before.total_clp / cursorValue - 1 : 0;
    subPeriods.push(r);
    cursorValue = before.total_clp + (m.type === 'aporte' ? 1 : -1) * Number(m.amount_clp || 0);
    cursorDate  = m.date;
  }

  const last = snaps[snaps.length - 1];
  if (last.date > cursorDate) {
    subPeriods.push(cursorValue > 0 ? last.total_clp / cursorValue - 1 : 0);
  }

  const twrPct = subPeriods.reduce((acc, r) => acc * (1 + r), 1) - 1;
  const aportes = movs.filter((m) => m.type === 'aporte').reduce((x, m) => x + Number(m.amount_clp || 0), 0);
  const retiros = movs.filter((m) => m.type === 'retiro').reduce((x, m) => x + Number(m.amount_clp || 0), 0);

  return {
    from: snaps[0].date, to: last.date,
    twr_pct: twrPct * 100,
    twr_clp_aprox: snaps[0].total_clp * twrPct,
    valor_inicial_clp: snaps[0].total_clp, valor_final_clp: last.total_clp,
    aportes_clp: aportes, retiros_clp: retiros, aportes_netos_clp: aportes - retiros,
    n_sub_periodos: subPeriods.length,
  };
}

function market(s) {
  const t = lastT(s), p = Math.max(0, t - 1);
  const dolar = {
    date: s.dates[t], usd_clp: s.fx[t],
    change_pct: s.fx[p] ? ((s.fx[t] - s.fx[p]) / s.fx[p]) * 100 : null,
  };
  const instruments = s.instruments
    .filter((i) => ['crypto', 'stock_us', 'stock_cl'].includes(i.type))
    .map((i) => {
      const arr = i.currency === 'USD' ? s.priceUsd[i.id] : s.priceClp[i.id];
      return {
        id: i.id, name: i.name, ticker: i.ticker, type: i.type, currency: i.currency,
        price_usd: s.priceUsd[i.id][t], price_clp: s.priceClp[i.id][t],
        date: s.dates[t], is_stale: false,
        change_pct: arr[p] ? ((arr[t] - arr[p]) / arr[p]) * 100 : null,
      };
    });
  instruments.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  return { dolar, instruments };
}

function latestPrices(s) {
  const t = lastT(s);
  return {
    prices: s.instruments.map((i) => ({
      instrument_id: i.id, name: i.name, ticker: i.ticker, type: i.type, currency: i.currency,
      price_clp: s.priceClp[i.id][t], price_usd: s.priceUsd[i.id][t],
      date: s.dates[t], is_stale: false, source: i.api_source,
    })),
    dolar: { usd_clp: s.fx[t], date: s.dates[t] },
  };
}

function priceHistory(s, id, from, to) {
  if (!s.priceClp[id]) return [];
  return s.dates
    .map((date, t) => ({
      date, price_clp: s.priceClp[id][t], price_usd: s.priceUsd[id][t],
      is_stale: false, source: 'demo',
    }))
    .filter((r) => (!from || r.date >= from) && (!to || r.date <= to));
}

// ── Chat IA simulado ──────────────────────────────────────────────────────────
function parseAmount(text) {
  const m = text.match(/\$?\s*(\d[\d.,\s]*)\s*(millones|millón|millon|mil|k)?/i);
  if (!m) return null;
  const n = Number(m[1].replace(/[.\s]/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'mil' || unit === 'k') return Math.round(n * 1000);
  if (unit.startsWith('mill')) return Math.round(n * 1_000_000);
  return Math.round(n);
}

const clp = (n) => `$${Math.round(n).toLocaleString('es-CL')}`;
const pct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2).replace('.', ',')}%`;

function aiChat(s, messages) {
  const text = String(messages[messages.length - 1]?.content || '').toLowerCase();
  const { positions, totalClp } = buildPositions(s);
  const today = todayISO(s);

  // ¿Pide registrar un movimiento?
  if (/(aport|retir|registr|deposit|saqu)/.test(text)) {
    const amount = parseAmount(text);
    if (amount) {
      const type = /(retir|saqu)/.test(text) ? 'retiro' : 'aporte';
      return {
        type: 'proposal',
        message: `Listo, preparé el ${type} por ${clp(amount)}. Confirmá para registrarlo.`,
        action: {
          endpoint: 'create_movement',
          params: { date: today, type, amount_clp: amount, notes: 'Registrado desde el chat' },
        },
      };
    }
  }

  const top = [...positions].sort((a, b) => b.value_clp - a.value_clp)[0];

  if (/(distribu|reparti|composici|diversific|asignaci)/.test(text)) {
    const lines = breakdown(s)
      .map((b) => `• ${b.type.replace(/_/g, ' ')}: ${clp(b.total_clp)} (${b.pct.toFixed(1)}%)`)
      .join('\n');
    return { type: 'message', content: `Tu portafolio suma ${clp(totalClp)} y se reparte así:\n\n${lines}` };
  }

  if (/(m[aá]s grande|mayor posici|principal|m[aá]s rentable|mejor)/.test(text)) {
    return {
      type: 'message',
      content: `Tu posición más grande es ${top.name}: ${clp(top.value_clp)}, un ${top.pct_portfolio.toFixed(1)}% del portafolio.`,
    };
  }

  if (/(gan[eé]|perd[ií]|rentab|rendimiento|mes|c[oó]mo va|vari)/.test(text)) {
    const ym = today.slice(0, 7);
    const mes = monthlyRentabilidad(s, `${ym}-01`, today)[0];
    if (mes) {
      return {
        type: 'message',
        content: `En ${ym} llevás ${pct(mes.rentabilidad_pct ?? 0)} (${clp(mes.rentabilidad_clp)}), descontando ${clp(mes.aportes_netos_clp)} de aportes netos. El patrimonio hoy es ${clp(totalClp)}.`,
      };
    }
  }

  if (/(d[oó]lar|usd|tipo de cambio)/.test(text)) {
    const d = market(s).dolar;
    return { type: 'message', content: `El dólar está en ${clp(d.usd_clp)} (${pct(d.change_pct ?? 0)} vs. el día anterior).` };
  }

  return {
    type: 'message',
    content: `Estás en el modo demo, con datos de ejemplo. Tu patrimonio simulado es ${clp(totalClp)} en ${positions.length} posiciones, y la más grande es ${top.name}. Podés pedirme la distribución, la rentabilidad del mes, o que registre un aporte.`,
  };
}

// ── Router ────────────────────────────────────────────────────────────────────
const ok   = (data) => ({ status: 200, data });
const bad  = (error) => ({ status: 400, data: { error } });
const nf   = (error) => ({ status: 404, data: { error } });

export function handle({ method, path, params = {}, body = {} }) {
  const s = getState();
  const seg = path.replace(/^\/+|\/+$/g, '').split('/');
  const [a, b, c] = seg;
  const m = method.toLowerCase();

  // ── custodians ──
  if (a === 'custodians') {
    if (m === 'get' && !b) return ok(DEMO_CUSTODIANS);
    if (m === 'post') {
      const name = String(body?.name || '').trim();
      if (name.length < 2) return bad('El nombre debe tener entre 2 y 80 caracteres');
      const existing = DEMO_CUSTODIANS.find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (existing) return { status: 201, data: existing };
      const created = {
        id: Math.max(...DEMO_CUSTODIANS.map((c) => c.id)) + 1,
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name, country: 'CL',
      };
      DEMO_CUSTODIANS.push(created);
      return { status: 201, data: created };
    }
  }

  // ── instruments ──
  if (a === 'instruments') {
    if (m === 'get' && !b) return ok(s.instruments);
    if (m === 'post') {
      const { name, type, currency, api_source } = body;
      if (!name || !type || !currency || !api_source) {
        return bad('name, type, currency y api_source son obligatorios');
      }
      const inst = {
        id: s.nextInstrumentId++, name, alias: body.alias ?? null, type,
        ticker: body.ticker ?? null, currency, api_source,
        external_id: body.external_id ?? null, meta: body.meta ?? {},
        created_at: new Date().toISOString(),
      };
      // Un instrumento nuevo en el demo arranca con precio plano.
      const p0 = Number(body.price_clp) || 1000;
      s.priceClp[inst.id] = s.dates.map(() => p0);
      s.priceUsd[inst.id] = s.dates.map((_, t) => p0 / s.fx[t]);
      s.instruments.push(inst);
      return { status: 201, data: inst };
    }
    const inst = s.instruments.find((i) => i.id === Number(b));
    if (!inst) return nf('Instrumento no encontrado');
    if (m === 'put') { Object.assign(inst, body, { id: inst.id }); return ok(inst); }
    if (m === 'delete') {
      s.instruments = s.instruments.filter((i) => i.id !== inst.id);
      delete s.units[inst.id];
      recomputeToday(s);
      return { status: 204, data: null };
    }
  }

  // ── positions ──
  if (a === 'positions') {
    if (m === 'get' && !b) return ok(buildPositions(s));

    if (m === 'post' && !b) {
      const instId = Number(body.instrument_id);
      const inst = s.instruments.find((i) => i.id === instId);
      if (!inst) return bad('instrument_id inválido');
      const t = lastT(s);
      let units = body.units != null ? Number(body.units) : null;
      if (units == null && body.amount_clp != null) units = Number(body.amount_clp) / s.priceClp[instId][t];
      if (units == null && body.amount_usd != null) units = Number(body.amount_usd) / s.priceUsd[instId][t];
      if (units == null) return bad('Indica units, amount_clp o amount_usd');
      s.units[instId] = units;
      recomputeToday(s);
      return { status: 201, data: { id: 1000 + instId, instrument_id: instId, units } };
    }

    const posId  = Number(b);
    const instId = posId - 1000;
    if (s.units[instId] == null) return nf('Posición no encontrada');
    const t = lastT(s);

    if (m === 'put') {
      let units = body.units != null ? Number(body.units) : null;
      if (units == null && body.amount_clp != null) units = Number(body.amount_clp) / s.priceClp[instId][t];
      if (units == null && body.amount_usd != null) units = Number(body.amount_usd) / s.priceUsd[instId][t];
      if (units == null) return bad('Indica units, amount_clp o amount_usd');
      s.units[instId] = units;
      recomputeToday(s);
      return ok({ id: posId, instrument_id: instId, units });
    }

    if (m === 'delete') {
      delete s.units[instId];
      recomputeToday(s);
      return { status: 204, data: null };
    }

    if (m === 'post' && c === 'aporte') {
      const type = body.type || 'aporte';
      if (!['aporte', 'retiro'].includes(type)) return bad("type debe ser 'aporte' o 'retiro'");
      const sign = type === 'retiro' ? -1 : 1;

      // En el demo todas las posiciones son por unidades: los deltas en plata se
      // convierten a cuotas al precio del día.
      let deltaUnits = null;
      if (body.delta_units != null)      deltaUnits = Number(body.delta_units);
      else if (body.delta_amount_clp != null) deltaUnits = Number(body.delta_amount_clp) / s.priceClp[instId][t];
      else if (body.delta_amount_usd != null) deltaUnits = Number(body.delta_amount_usd) / s.priceUsd[instId][t];
      if (deltaUnits == null || !Number.isFinite(deltaUnits)) {
        return bad('Indica delta_units, delta_amount_clp o delta_amount_usd');
      }

      s.units[instId] = Math.max(0, s.units[instId] + sign * deltaUnits);

      const clpMov = body.delta_amount_clp != null
        ? Number(body.delta_amount_clp)
        : (body.movement_clp != null ? Number(body.movement_clp) : deltaUnits * s.priceClp[instId][t]);

      const mov = {
        id: s.nextMovementId++, user_id: DEMO_USER.id, instrument_id: null,
        date: body.date || todayISO(s), type, amount_clp: clpMov, amount_usd: null,
        notes: body.notes ?? null, created_at: new Date().toISOString(),
        instrument_name: null, instrument_type: null,
      };
      s.movements.push(mov);
      recomputeToday(s);
      return { status: 201, data: { position: { id: posId, instrument_id: instId, units: s.units[instId] }, movement: mov } };
    }
  }

  // ── movements ──
  if (a === 'movements') {
    if (m === 'get' && !b) {
      let rows = [...s.movements];
      if (params.from) rows = rows.filter((x) => x.date >= params.from);
      if (params.to)   rows = rows.filter((x) => x.date <= params.to);
      if (params.type) rows = rows.filter((x) => x.type === params.type);
      if (params.instrument_id) rows = rows.filter((x) => String(x.instrument_id) === String(params.instrument_id));
      rows.sort((x, y) => y.date.localeCompare(x.date) || y.id - x.id);
      return ok(rows);
    }
    if (m === 'post') {
      if (!body.date || !body.type) return bad('date y type son obligatorios');
      if (!['aporte', 'retiro'].includes(body.type)) return bad("type debe ser 'aporte' o 'retiro'");
      const mov = {
        id: s.nextMovementId++, user_id: DEMO_USER.id,
        instrument_id: body.instrument_id ?? null,
        date: body.date, type: body.type,
        amount_clp: body.amount_clp ?? null, amount_usd: body.amount_usd ?? null,
        notes: body.notes ?? null, created_at: new Date().toISOString(),
        instrument_name: null, instrument_type: null,
      };
      s.movements.push(mov);
      return { status: 201, data: mov };
    }
    const mov = s.movements.find((x) => x.id === Number(b));
    if (!mov) return nf('Movimiento no encontrado');
    if (m === 'put') {
      Object.assign(mov, {
        date: body.date ?? mov.date, type: body.type ?? mov.type,
        amount_clp: body.amount_clp ?? null, amount_usd: body.amount_usd ?? null,
        notes: body.notes ?? null,
      });
      return ok(mov);
    }
    if (m === 'delete') {
      s.movements = s.movements.filter((x) => x.id !== mov.id);
      return { status: 204, data: null };
    }
  }

  // ── prices ──
  if (a === 'prices') {
    if (m === 'get' && b === 'latest') return ok(latestPrices(s));
    if (m === 'post' && b === 'refresh') {
      return ok({ ok: true, message: 'Modo demo: los precios son simulados y ya están al día.' });
    }
    if (m === 'post' && b === 'manual') {
      const id = Number(body.instrument_id);
      if (!s.priceClp[id]) return bad('instrument_id inválido');
      const t = lastT(s);
      if (body.price_clp != null) {
        s.priceClp[id][t] = Number(body.price_clp);
        s.priceUsd[id][t] = Number(body.price_clp) / s.fx[t];
      } else if (body.price_usd != null) {
        s.priceUsd[id][t] = Number(body.price_usd);
        s.priceClp[id][t] = Number(body.price_usd) * s.fx[t];
      } else {
        return bad('Indica price_clp o price_usd');
      }
      recomputeToday(s);
      return { status: 201, data: { instrument_id: id, date: s.dates[t] } };
    }
    if (m === 'get' && b) return ok(priceHistory(s, Number(b), params.from, params.to));
  }

  // ── portfolio ──
  if (a === 'portfolio') {
    if (m === 'get' && b === 'summary')   return ok(summary(s));
    if (m === 'get' && b === 'snapshots') return ok(snapshots(s, params.from, params.to));
    if (m === 'get' && b === 'breakdown') return ok(breakdown(s));
    if (m === 'get' && b === 'twr') {
      if (!params.from || !params.to) return bad('from y to son obligatorios');
      return ok(twr(s, params.from, params.to));
    }
    if (m === 'get' && b === 'rentabilidad' && c === 'monthly') {
      return ok(monthlyRentabilidad(s, params.from || s.dates[0], params.to || todayISO(s)));
    }
    if (m === 'get' && b === 'rentabilidad') {
      if (!params.from || !params.to) return bad('from y to son obligatorios');
      return ok(rentabilidad(s, params.from, params.to));
    }
    if (m === 'post' && b === 'snapshot') {
      recomputeToday(s);
      return ok(s.snapshots[lastT(s)]);
    }
  }

  // ── statements (cartolas) ──
  // El demo no llama a ninguna IA: devuelve una propuesta sintética armada con
  // los primeros instrumentos del dataset, ya con "candidatos" para que la
  // pantalla de revisión se vea igual que en la app real.
  if (a === 'statements') {
    if (m === 'get' && !b) return ok(s.demoStatements || []);

    if (m === 'post' && !b) {
      const id = `demo-stmt-${(s.demoStatements?.length || 0) + 1}`;
      const custodianId = body?.custodian_id != null && body.custodian_id !== ''
        ? Number(body.custodian_id)
        : 1; // Fintual
      const fecha = todayISO(s);
      const rows = s.instruments.slice(0, 3).map((i) => ({
        instrument_name: i.name.toUpperCase(),
        units: Number((10 + i.id * 3.5).toFixed(4)),
        amount_clp: null,
        amount_usd: null,
        notes: 'Serie A',
        candidates: [{
          id: i.id, name: i.name, alias: i.alias, ticker: i.ticker,
          type: i.type, currency: i.currency, status: 'active', similarity: 0.92,
        }],
      }));
      const stmt = {
        id, custodian_id: custodianId, statement_date: fecha, status: 'parsed',
        file_name: 'cartola-demo.pdf', rows_proposed: rows.length,
      };
      s.demoStatements = [...(s.demoStatements || []), { ...stmt, rows }];
      return { status: 201, data: {
        statement: stmt,
        custodian_suggestion: { id: 1, slug: 'fintual', name: 'Fintual' },
        custodian_name_detectado: 'Fintual',
        rows,
      }};
    }

    const stmt = (s.demoStatements || []).find((x) => x.id === b);
    if (!stmt) return nf('Cartola no encontrada');

    if (m === 'get')  return ok({ statement: stmt, rows: stmt.rows });
    if (m === 'put')  { Object.assign(stmt, body || {}); return ok(stmt); }
    if (m === 'delete') {
      s.demoStatements = s.demoStatements.filter((x) => x.id !== b);
      return { status: 204, data: null };
    }

    if (m === 'post' && c === 'confirm') {
      const t = lastT(s);
      let applied = 0;
      for (const r of body?.rows || []) {
        const instId = Number(r.instrument_id);
        if (!instId || !s.priceClp[instId]) continue;
        // El demo modela todo por unidades: los montos se convierten al precio del día.
        let units = r.units != null ? Number(r.units) : null;
        if (units == null && r.amount_clp != null) units = Number(r.amount_clp) / s.priceClp[instId][t];
        if (units == null && r.amount_usd != null) units = Number(r.amount_usd) / s.priceUsd[instId][t];
        if (units == null || !Number.isFinite(units)) continue;
        s.units[instId] = units;
        applied++;
      }
      recomputeToday(s);
      stmt.status = 'confirmed';
      stmt.rows_confirmed = applied;
      return ok({ statement_id: b, date: stmt.statement_date, applied, created: [] });
    }
  }

  // ── market ──
  if (a === 'market' && m === 'get') return ok(market(s));

  // ── ai ──
  if (a === 'ai' && m === 'post' && b === 'chat') {
    const msgs = body?.messages;
    if (!Array.isArray(msgs) || !msgs.length) return bad('messages requerido');
    return ok(aiChat(s, msgs));
  }
  if (a === 'ai' && m === 'post' && b === 'parse-cartola') {
    const t = lastT(s);
    return ok({
      proposals: s.instruments.slice(0, 3).map((i) => ({
        instrument_name: i.name,
        instrument_id: i.id,
        units: Number((s.units[i.id] ?? 10).toFixed(4)),
        notes: `Detectado en la cartola (demo) — valorizado al ${s.dates[t]}`,
      })),
    });
  }

  return nf(`Endpoint no disponible en el modo demo: ${method.toUpperCase()} /${seg.join('/')}`);
}
