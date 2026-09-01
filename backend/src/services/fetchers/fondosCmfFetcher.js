// Fondos Mutuos chilenos via CMF (Comisión para el Mercado Financiero).
// Endpoint validado (devuelve un .xls BIFF):
//   fm.fm_bpr_dia.php?admins=<RUT_ADMIN>&ffmm=<CODIGO_FONDO>
//     &dia2_select=&mes2=&anno2=  (desde)  &dia3_select=&mes3=&anno3=  (hasta)
//     &out=excel&lang=es
//
// La planilla trae filas: [fecha dd/mm/yyyy, RUN, tipo, admin, serie, moneda,
//                          patrimonio, n_participes, valor_cuota]
// Validado contra certificado Fintual: diferencia total -0.001%.
//
// El valor cuota llega con ~1 día hábil de retraso (normal en Chile), así que la
// consulta siempre es por ventana. La planilla trae TODAS las fechas del rango:
// fetchSerieFondoCmf las devuelve completas —un request llena la ventana entera de
// un instrumento— y fetchFondoCmf se queda con la más reciente, para los llamadores
// que solo quieren el precio de hoy.

import * as XLSX from 'xlsx';
import { fetchConTimeout } from './http.js';
import { addDays, todayCL } from '../../utils/dates.js';

const BASE = 'https://www.cmfchile.cl/institucional/estadisticas/fm.fm_bpr_dia.php';

/**
 * Todos los valores cuota de un fondo en un rango de fechas.
 *
 * Es un solo request: la planilla ya viene con el rango completo. Antes se
 * descartaba todo menos la fila más reciente, lo que obligaba a un job por fecha
 * que además nunca se podía satisfacer.
 *
 * @param {object} opts
 * @param {string} opts.admin   - RUT administradora sin DV (ej '76810627')
 * @param {string} opts.codigo  - código/RUN del fondo (ej '9570')
 * @param {string} [opts.serie] - serie a filtrar (ej 'A'). Default 'A'.
 * @param {string} opts.since   - desde, 'YYYY-MM-DD'
 * @param {string} opts.until   - hasta, 'YYYY-MM-DD'
 * @returns {Promise<Array<{date: string, price_clp: number}>>} ordenado por fecha
 */
export async function fetchSerieFondoCmf({ admin, codigo, serie = 'A', since, until }) {
  const [aDesde, mDesde, dDesde] = since.split('-');
  const [aHasta, mHasta, dHasta] = until.split('-');

  const params = new URLSearchParams({
    admins: admin,
    ffmm: codigo,
    dia2_select: String(Number(dDesde)),
    mes2: mDesde,
    anno2: aDesde,
    dia3_select: String(Number(dHasta)),
    mes3: mHasta,
    anno3: aHasta,
    out: 'excel',
    lang: 'es',
  });

  const url = `${BASE}?${params.toString()}`;
  const res = await fetchConTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeoutMs: 25_000 });
  if (!res.ok) throw new Error(`CMF respondió ${res.status} para fondo ${codigo}`);

  const buf = Buffer.from(await res.arrayBuffer());
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });

  // Buscar filas de datos: col0 = fecha dd/mm/yyyy, col4 = serie, col8 = valor cuota
  const porFecha = new Map();
  for (const row of rows) {
    const fecha = row?.[0];
    const filaSerie = row?.[4];
    const valor = row?.[8];
    if (typeof fecha !== 'string') continue;
    const m = fecha.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) continue;
    if (String(filaSerie).trim().toUpperCase() !== serie.toUpperCase()) continue;
    const valorNum = Number(valor);
    if (!Number.isFinite(valorNum) || valorNum <= 0) continue;

    const [, dd, mm, yyyy] = m;
    porFecha.set(`${yyyy}-${mm}-${dd}`, valorNum);
  }

  return [...porFecha.entries()]
    .map(([date, price_clp]) => ({ date, price_clp }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * El valor cuota más reciente de un fondo. Wrapper sobre fetchSerieFondoCmf para
 * los llamadores que solo quieren el precio de hoy (el refresh manual de la UI).
 *
 * @param {number} [opts.windowDays] - días hacia atrás a consultar. Default 10.
 * @returns {Promise<{date: string, price_clp: number, serie: string}>}
 */
export async function fetchFondoCmf({ admin, codigo, serie = 'A', windowDays = 10 }) {
  const until = todayCL();
  const serieRows = await fetchSerieFondoCmf({
    admin, codigo, serie, since: addDays(until, -windowDays), until,
  });

  if (serieRows.length === 0) {
    throw new Error(`CMF: sin valor cuota para fondo ${codigo} serie ${serie} en los últimos ${windowDays} días`);
  }

  const ultimo = serieRows[serieRows.length - 1];
  return { date: ultimo.date, price_clp: ultimo.price_clp, serie };
}
