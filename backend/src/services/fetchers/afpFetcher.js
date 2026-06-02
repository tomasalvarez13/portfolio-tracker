// Valor cuota de Fondos de Pensiones / APV via Superintendencia de Pensiones.
// Endpoint validado (POST):
//   vcfAFP.php?tf=<A|B|C|D|E>   body: aaaa=YYYY&mm=MM&dd=DD&btn=Buscar
// Devuelve HTML con tabla: AFP | Valor Cuota | Valor del Patrimonio
// Validado: PLANVITAL Fondo A = $89.617,87 (calce exacto con cartola).
//
// Los valores tienen retraso (provisorios sujetos a confirmación). Reintentamos
// hacia atrás hasta encontrar un día con dato para la AFP buscada.

const BASE = 'https://www.spensiones.cl/apps/valoresCuotaFondo/vcfAFP.php';

function pad2(n) { return String(n).padStart(2, '0'); }

/** Convierte "89.617,87" (formato chileno) -> 89617.87 */
function parseClpNumber(str) {
  if (!str) return NaN;
  const clean = String(str).replace(/&nbsp;/g, '').trim().replace(/\./g, '').replace(',', '.');
  return Number(clean);
}

/**
 * Trae el valor cuota de una AFP para un tipo de fondo.
 * @param {object} opts
 * @param {string} opts.afp        - nombre tal como aparece en SP (ej 'PLANVITAL')
 * @param {string} [opts.tipoFondo]- 'A'|'B'|'C'|'D'|'E'. Default 'A'.
 * @param {number} [opts.maxBack]  - días hábiles a reintentar. Default 7.
 * @returns {Promise<{date: string, price_clp: number}>}
 */
export async function fetchAfpCuota({ afp, tipoFondo = 'A', maxBack = 7 }) {
  const afpUpper = afp.toUpperCase();
  const today = new Date();

  for (let i = 0; i < maxBack; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    // Saltar fines de semana
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;

    const body = new URLSearchParams({
      aaaa: String(d.getFullYear()),
      mm: pad2(d.getMonth() + 1),
      dd: pad2(d.getDate()),
      btn: 'Buscar',
    });

    const url = `${BASE}?tf=${encodeURIComponent(tipoFondo)}`;
    let html;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      html = buf.toString('latin1'); // la página viene en ISO-8859-1
    } catch {
      continue;
    }

    // Buscar fila <td>AFP</td><td>valor</td>...  (la primera columna es el nombre)
    // Construimos un regex tolerante a clases/espacios.
    const rowRe = new RegExp(
      `${afpUpper}\\s*</td>\\s*<td[^>]*>([^<]+)</td>`,
      'i'
    );
    const m = html.match(rowRe);
    if (m) {
      const valor = parseClpNumber(m[1]);
      if (Number.isFinite(valor) && valor > 0) {
        return {
          date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
          price_clp: valor,
        };
      }
    }
  }

  throw new Error(`SP: sin valor cuota para AFP ${afp} fondo ${tipoFondo} en los últimos ${maxBack} días`);
}
