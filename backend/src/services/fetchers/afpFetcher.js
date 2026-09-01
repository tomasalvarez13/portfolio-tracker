// Valor cuota de Fondos de Pensiones / APV via Superintendencia de Pensiones.
// Endpoint validado (POST):
//   vcfAFP.php?tf=<A|B|C|D|E>   body: aaaa=YYYY&mm=MM&dd=DD&btn=Buscar
// Devuelve HTML con tabla: AFP | Valor Cuota | Valor del Patrimonio
// Validado: PLANVITAL Fondo A = $89.617,87 (calce exacto con cartola).
//
// Los valores tienen retraso (provisorios sujetos a confirmación), así que hay que
// recorrer hacia atrás. La página es de a un día: fetchSerieAfpCuota junta todos
// los días del rango en la misma pasada —mismo costo que buscar uno solo, N veces
// más resultado— y fetchAfpCuota corta en el primero que encuentra, para los
// llamadores que solo quieren el precio de hoy.

import { fetchConTimeout, presupuesto } from './http.js';
import { addDays, isWeekend, todayCL } from '../../utils/dates.js';

const BASE = 'https://www.spensiones.cl/apps/valoresCuotaFondo/vcfAFP.php';

// Cada día es un POST. Un timeout por request no acota el total, así que el job
// completo lleva su propio techo. La serie recorre más días, y si el presupuesto
// se agota devuelve lo que alcanzó a juntar en vez de fallar entera.
const PRESUPUESTO_MS = 45_000;
const PRESUPUESTO_SERIE_MS = 60_000;

/** Convierte "89.617,87" (formato chileno) -> 89617.87 */
function parseClpNumber(str) {
  if (!str) return NaN;
  const clean = String(str).replace(/&nbsp;/g, '').trim().replace(/\./g, '').replace(',', '.');
  return Number(clean);
}

/** El valor cuota de un día puntual, o null si ese día no tiene dato. */
async function cuotaDelDia(afpUpper, tipoFondo, iso) {
  const [aaaa, mm, dd] = iso.split('-');
  const body = new URLSearchParams({ aaaa, mm, dd, btn: 'Buscar' });

  let html;
  try {
    const res = await fetchConTimeout(`${BASE}?tf=${encodeURIComponent(tipoFondo)}`, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    html = buf.toString('latin1'); // la página viene en ISO-8859-1
  } catch {
    return null;
  }

  // Buscar fila <td>AFP</td><td>valor</td>...  (la primera columna es el nombre)
  // Construimos un regex tolerante a clases/espacios.
  const m = html.match(new RegExp(`${afpUpper}\\s*</td>\\s*<td[^>]*>([^<]+)</td>`, 'i'));
  if (!m) return null;

  const valor = parseClpNumber(m[1]);
  return Number.isFinite(valor) && valor > 0 ? valor : null;
}

/**
 * Todos los valores cuota de una AFP en un rango de fechas.
 *
 * @param {object} opts
 * @param {string} opts.afp        - nombre tal como aparece en SP (ej 'PLANVITAL')
 * @param {string} [opts.tipoFondo]- 'A'|'B'|'C'|'D'|'E'. Default 'A'.
 * @param {string} opts.since      - desde, 'YYYY-MM-DD'
 * @param {string} opts.until      - hasta, 'YYYY-MM-DD', inclusive
 * @returns {Promise<Array<{date: string, price_clp: number}>>} ordenado por fecha
 */
export async function fetchSerieAfpCuota({ afp, tipoFondo = 'A', since, until }) {
  const afpUpper = afp.toUpperCase();
  const plazo = presupuesto(PRESUPUESTO_SERIE_MS);
  const salida = [];

  // De la más reciente hacia atrás: si el presupuesto corta, lo que se pierde son
  // los días viejos, no el precio de ayer.
  for (let iso = until; iso >= since; iso = addDays(iso, -1)) {
    if (plazo.agotado()) break;
    if (isWeekend(iso)) continue;
    const valor = await cuotaDelDia(afpUpper, tipoFondo, iso);
    if (valor != null) salida.push({ date: iso, price_clp: valor });
  }

  return salida.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * El valor cuota más reciente de una AFP, buscando hacia atrás desde hoy.
 *
 * @param {number} [opts.maxBack] - días a reintentar. Default 7.
 * @returns {Promise<{date: string, price_clp: number}>}
 */
export async function fetchAfpCuota({ afp, tipoFondo = 'A', maxBack = 7 }) {
  const afpUpper = afp.toUpperCase();
  const plazo = presupuesto(PRESUPUESTO_MS);
  const hoy = todayCL();

  for (let i = 0; i < maxBack; i++) {
    if (plazo.agotado()) break;
    const iso = addDays(hoy, -i);
    if (isWeekend(iso)) continue;
    const valor = await cuotaDelDia(afpUpper, tipoFondo, iso);
    if (valor != null) return { date: iso, price_clp: valor };
  }

  if (plazo.agotado()) {
    throw new Error(`SP: no alcanzó a responder para AFP ${afp} fondo ${tipoFondo} en ${PRESUPUESTO_MS / 1000}s`);
  }
  throw new Error(`SP: sin valor cuota para AFP ${afp} fondo ${tipoFondo} en los últimos ${maxBack} días`);
}
