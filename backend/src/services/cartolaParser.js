// Extracción de posiciones desde una cartola (PDF o imagen), con Gemini.
//
// La diferencia con la versión anterior: el prompt ya NO lleva el maestro de
// instrumentos. Antes se le mandaba la lista completa para que el modelo hiciera
// el matching, lo que ataba el costo por cartola al tamaño del maestro y
// degradaba el resultado a medida que crecía.
//
// Ahora el modelo solo hace lo que un modelo hace bien: leer el documento y
// devolver lo que dice. El matching contra el maestro se resuelve después en
// SQL con trigramas (match_instruments), que es determinista, auditable, no
// consume tokens y no crece con el maestro.

import { GoogleGenerativeAI } from '@google/generative-ai';

const MODEL = 'gemini-2.5-flash';

function getClient() {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY no configurada en el servidor');
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

const PROMPT = `Analizá este documento financiero (una cartola de inversiones) y extraé lo que dice, sin interpretar ni completar nada.

Devolvé un objeto JSON con esta forma exacta:

{
  "custodian_name": "nombre de la institución que emite la cartola, tal como aparece, o null",
  "statement_date": "fecha de valorización del documento en formato YYYY-MM-DD, o null",
  "rows": [
    {
      "instrument_name": "nombre del instrumento TAL COMO APARECE en el documento",
      "units": número de cuotas/unidades/acciones, o null,
      "amount_clp": monto en pesos chilenos como número, o null,
      "amount_usd": monto en dólares como número, o null,
      "notes": "serie, tipo de fondo u otra observación breve, o null"
    }
  ]
}

Reglas:
- instrument_name se copia literal del documento. No lo normalices, no lo traduzcas, no le agregues ni le saques nada.
- Si una posición está expresada en cuotas, poné units y dejá los montos en null. Si está expresada solo en plata, poné el monto en la moneda que corresponda y units en null.
- Los números van sin separadores de miles ni símbolo de moneda. Usá punto decimal.
- No inventes filas. Si el documento no tiene posiciones, devolvé "rows": [].
- No incluyas totales, subtotales ni líneas de resumen como si fueran posiciones.

Respondé ÚNICAMENTE con el JSON, sin texto adicional y sin bloques markdown.`;

/** Gemini a veces envuelve la respuesta en ```json … ```. */
function stripFence(text) {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normaliza la salida del modelo a algo con lo que se pueda trabajar.
 * Es defensiva a propósito: la respuesta viene de un LLM, no de una API.
 */
export function normalizeParse(raw) {
  const out = {
    custodian_name: typeof raw?.custodian_name === 'string' ? raw.custodian_name.trim() || null : null,
    statement_date: ISO_DATE.test(raw?.statement_date || '') ? raw.statement_date : null,
    rows: [],
  };

  // Toleramos que devuelva un array pelado en vez del objeto.
  const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.rows) ? raw.rows : [];

  for (const r of rows) {
    const name = typeof r?.instrument_name === 'string' ? r.instrument_name.trim() : '';
    if (!name) continue;

    const units = num(r.units);
    const clp   = num(r.amount_clp);
    const usd   = num(r.amount_usd);

    // Filas en cero o vacías no son posiciones: son totales, encabezados o ruido.
    if (!(units > 0 || clp > 0 || usd > 0)) continue;

    out.rows.push({
      instrument_name: name.slice(0, 200),
      units, amount_clp: clp, amount_usd: usd,
      notes: typeof r.notes === 'string' ? r.notes.trim().slice(0, 200) || null : null,
    });
  }

  return out;
}

/**
 * Extrae las posiciones de un archivo de cartola.
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @returns {Promise<{custodian_name:string|null, statement_date:string|null, rows:object[]}>}
 */
export async function parseCartolaFile(buffer, mimeType) {
  const model = getClient().getGenerativeModel({ model: MODEL });

  const result = await model.generateContent([
    { inlineData: { mimeType, data: buffer.toString('base64') } },
    { text: PROMPT },
  ]);

  let raw;
  try {
    raw = JSON.parse(stripFence(result.response.text()));
  } catch {
    // Sin JSON parseable no hay nada que proponer, pero la cartola igual queda
    // guardada con su raw_parse vacío para poder reprocesarla después.
    return { custodian_name: null, statement_date: null, rows: [] };
  }

  return normalizeParse(raw);
}
