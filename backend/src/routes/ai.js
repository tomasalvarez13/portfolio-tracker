// Rutas de IA: parseo de cartola y chat de portafolio — powered by Google Gemini.
import { Router } from 'express';
import multer from 'multer';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { query } from '../config/db.js';
import { computePositions } from '../services/portfolioService.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const ok = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(null, ok);
  },
});

function getClient() {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY no configurada en el servidor');
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

// ─── Helpers de formato ───────────────────────────────────────────────────────

// Convierte mensajes del frontend { role:'user'|'assistant', content } al formato Gemini
function toGeminiContents(messages) {
  return messages
    .filter(m => m.content)
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
}

// ─── POST /api/ai/parse-cartola ───────────────────────────────────────────────
router.post('/parse-cartola', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo. Enviá un PDF o imagen.' });

  try {
    const genAI = getClient();
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const { rows: instruments } = await query(
      'SELECT id, name, alias, ticker, type FROM instruments ORDER BY name'
    );

    const base64 = req.file.buffer.toString('base64');
    const mime   = req.file.mimetype;

    const prompt = `Analizá este documento financiero y extraé todas las posiciones de inversión que encuentres.

Instrumentos disponibles en el sistema (intentá hacer coincidir por nombre o ticker):
${JSON.stringify(instruments.map(i => ({ id: i.id, name: i.alias || i.name, ticker: i.ticker })))}

Para cada posición devolvé un objeto con estos campos (omitir los que no correspondan):
- instrument_name: nombre tal como aparece en el documento
- instrument_id: id del instrumento del sistema si encontrás coincidencia clara
- units: número de cuotas o unidades (si la posición es en unidades)
- amount_clp: monto en pesos chilenos como número entero (si es en CLP)
- amount_usd: monto en dólares como número (si es en USD)
- notes: observación útil (ej: "Fondo Serie A", fecha de valorización)

Respondé ÚNICAMENTE con un array JSON válido, sin texto adicional, sin bloques markdown.`;

    const result = await model.generateContent([
      { inlineData: { mimeType: mime, data: base64 } },
      { text: prompt },
    ]);

    const text = result.response.text().trim();
    // Gemini a veces envuelve en ```json ... ```, limpiar por las dudas
    const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

    let proposals = [];
    try { proposals = JSON.parse(clean); } catch { proposals = []; }

    res.json({ proposals });
  } catch (e) {
    console.error('[ai/parse-cartola]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Definición de herramientas para el chat ──────────────────────────────────
const FUNCTION_DECLARATIONS = [
  {
    name: 'get_portfolio',
    description: 'Obtiene las posiciones actuales del portafolio con valores y porcentajes al día',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_movements',
    description: 'Obtiene el historial de aportes y retiros',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Fecha inicio YYYY-MM-DD (opcional)' },
        to:   { type: 'string', description: 'Fecha fin YYYY-MM-DD (opcional)'   },
      },
    },
  },
  {
    name: 'create_movement',
    description: 'Propone registrar un aporte o retiro a nivel de portafolio',
    parameters: {
      type: 'object',
      properties: {
        date:       { type: 'string',  description: 'Fecha YYYY-MM-DD'           },
        type:       { type: 'string',  description: "'aporte' o 'retiro'"        },
        amount_clp: { type: 'number',  description: 'Monto en pesos chilenos'    },
        notes:      { type: 'string',  description: 'Descripción del movimiento' },
      },
      required: ['date', 'type', 'amount_clp'],
    },
  },
  {
    name: 'add_to_position',
    description: 'Propone agregar o retirar de una posición existente y registrar el movimiento',
    parameters: {
      type: 'object',
      properties: {
        instrument_name: { type: 'string', description: 'Nombre del instrumento tal como aparece en el portafolio' },
        type:         { type: 'string', description: "'aporte' o 'retiro'"                              },
        delta:        { type: 'number', description: 'Cantidad a agregar/quitar (siempre positivo)'      },
        mode:         { type: 'string', description: "'units', 'amount_clp' o 'amount_usd'"             },
        movement_clp: { type: 'number', description: 'Monto CLP para historial (si mode != amount_clp)' },
        date:         { type: 'string', description: 'Fecha YYYY-MM-DD'                                  },
        notes:        { type: 'string' },
      },
      required: ['instrument_name', 'type', 'delta', 'mode', 'date'],
    },
  },
];

const WRITE_TOOLS = new Set(['create_movement', 'add_to_position']);

async function executeReadTool(name, args, userId) {
  if (name === 'get_portfolio') return await computePositions(userId);
  if (name === 'get_movements') {
    const clauses = ['user_id = $1']; const params = [userId];
    if (args.from) { params.push(args.from); clauses.push(`date >= $${params.length}`); }
    if (args.to)   { params.push(args.to);   clauses.push(`date <= $${params.length}`); }
    const { rows } = await query(
      `SELECT m.*, i.name AS instrument_name FROM movements m
       LEFT JOIN instruments i ON i.id = m.instrument_id
       WHERE ${clauses.join(' AND ')} ORDER BY date DESC LIMIT 50`,
      params
    );
    return rows;
  }
  return null;
}

async function resolveWriteTool(name, args, userId) {
  if (name === 'create_movement') return { endpoint: 'create_movement', params: args };
  if (name === 'add_to_position') {
    const { rows } = await query(
      `SELECT p.id, p.units, p.amount_clp, p.amount_usd, i.name, i.alias, i.ticker
       FROM positions p JOIN instruments i ON i.id = p.instrument_id
       WHERE p.user_id = $1
         AND (LOWER(i.name) LIKE $2 OR LOWER(COALESCE(i.alias,'')) LIKE $2 OR LOWER(COALESCE(i.ticker,'')) LIKE $2)
       LIMIT 1`,
      [userId, `%${args.instrument_name.toLowerCase()}%`]
    );
    return { endpoint: 'add_to_position', position: rows[0] || null, params: args };
  }
}

// ─── POST /api/ai/chat ────────────────────────────────────────────────────────
router.post('/chat', async (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages requerido' });
  }

  try {
    const genAI = getClient();
    const today = new Date().toISOString().slice(0, 10);

    // Contexto del portafolio
    let portfolioCtx = '';
    try {
      const data = await computePositions(req.user.id);
      const resumen = data.positions.map(p => ({
        nombre:    p.alias || p.name,
        tipo:      p.type,
        valor_clp: Math.round(p.value_clp || 0),
        pct:       `${(p.pct_portfolio || 0).toFixed(1)}%`,
        ...(p.units      != null ? { unidades:  p.units }       : {}),
        ...(p.amount_clp != null ? { monto_clp: p.amount_clp }  : {}),
        ...(p.amount_usd != null ? { monto_usd: p.amount_usd }  : {}),
      }));
      portfolioCtx = `\nPortafolio actual (${today}):\nTotal CLP: $${Math.round(data.totalClp || 0).toLocaleString('es-CL')}\nPosiciones:\n${JSON.stringify(resumen, null, 2)}`;
    } catch { portfolioCtx = '\n(No se pudo cargar el portafolio)'; }

    const systemInstruction = `Sos un asistente financiero personal para una app de seguimiento de inversiones en Chile.
Respondés siempre en español. Sos directo, conciso y útil. La fecha de hoy es ${today}.
${portfolioCtx}

Podés responder preguntas sobre el portafolio, hacer análisis y recomendaciones, y proponer registrar movimientos usando las herramientas disponibles. El usuario siempre confirma antes de que se ejecute cualquier acción de escritura.`;

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction,
      tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
    });

    // Historial en formato Gemini (excluye el último mensaje del usuario que se envía aparte)
    let contents = toGeminiContents(messages);

    // Loop agéntico: ejecutar read-tools automáticamente; detenerse en write-tool
    for (let iter = 0; iter < 6; iter++) {
      const result   = await model.generateContent({ contents });
      const parts    = result.response.candidates?.[0]?.content?.parts || [];
      const textPart = parts.find(p => p.text);
      const funcCall = parts.find(p => p.functionCall);

      // Respuesta de texto puro
      if (!funcCall) {
        return res.json({ type: 'message', content: textPart?.text || '' });
      }

      const { name, args } = funcCall.functionCall;

      // Write tool → devolver propuesta al frontend
      if (WRITE_TOOLS.has(name)) {
        const action = await resolveWriteTool(name, args, req.user.id);
        return res.json({ type: 'proposal', action, message: textPart?.text || '' });
      }

      // Read tool → ejecutar y continuar conversación
      const toolResult = await executeReadTool(name, args, req.user.id);

      contents = [
        ...contents,
        { role: 'model', parts },                                    // respuesta del modelo con la llamada
        { role: 'user',  parts: [{                                   // resultado de la herramienta
            functionResponse: { name, response: { result: JSON.stringify(toolResult) } },
        }]},
      ];
    }

    res.json({ type: 'message', content: 'No pude procesar la consulta. Intentá de nuevo.' });
  } catch (e) {
    console.error('[ai/chat]', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
