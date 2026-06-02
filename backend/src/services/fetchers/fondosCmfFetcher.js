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
// El valor cuota llega con ~1 día hábil de retraso (normal en Chile). Por eso
// consultamos una ventana de varios días y tomamos la fila más reciente de la serie.

import * as XLSX from 'xlsx';

const BASE = 'https://www.cmfchile.cl/institucional/estadisticas/fm.fm_bpr_dia.php';

function pad2(n) { return String(n).padStart(2, '0'); }

/**
 * Trae el valor cuota más reciente de un fondo mutuo CMF.
 * @param {object} opts
 * @param {string} opts.admin     - RUT administradora sin DV (ej '76810627')
 * @param {string} opts.codigo    - código/RUN del fondo (ej '9570')
 * @param {string} [opts.serie]   - serie a filtrar (ej 'A'). Default 'A'.
 * @param {number} [opts.windowDays] - días hacia atrás a consultar. Default 10.
 * @returns {Promise<{date: string, price_clp: number, serie: string}>}
 */
export async function fetchFondoCmf({ admin, codigo, serie = 'A', windowDays = 10 }) {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - windowDays);

  const params = new URLSearchParams({
    admins: admin,
    ffmm: codigo,
    dia2_select: String(from.getDate()),
    mes2: pad2(from.getMonth() + 1),
    anno2: String(from.getFullYear()),
    dia3_select: String(today.getDate()),
    mes3: pad2(today.getMonth() + 1),
    anno3: String(today.getFullYear()),
    out: 'excel',
    lang: 'es',
  });

  const url = `${BASE}?${params.toString()}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`CMF respondió ${res.status} para fondo ${codigo}`);

  const buf = Buffer.from(await res.arrayBuffer());
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });

  // Buscar filas de datos: col0 = fecha dd/mm/yyyy, col4 = serie, col8 = valor cuota
  let best = null; // { date: Date, iso, valor }
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
    const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
    if (!best || d > best.date) {
      best = { date: d, iso: `${yyyy}-${mm}-${dd}`, valor: valorNum };
    }
  }

  if (!best) {
    throw new Error(`CMF: sin valor cuota para fondo ${codigo} serie ${serie} en los últimos ${windowDays} días`);
  }

  return { date: best.iso, price_clp: best.valor, serie };
}
