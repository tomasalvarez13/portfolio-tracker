// Rutas de IA: parseo de cartola y chat de portafolio.
import { Router } from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
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
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY no configurada en el servidor');
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ─── POST /api/ai/parse-cartola ───────────────────────────────────────────────
// Recibe un PDF o imagen, extrae posiciones con Claude y devuelve propuestas.
router.post('/parse-cartola', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo. Enviá un PDF o imagen.' });

  try {
    const client = getClient();
    const { rows: instruments } = await query(
      'SELECT id, name, alias, ticker, type FROM instruments ORDER BY name'
    );

    const base64 = req.file.buffer.toString('base64');
    const mime   = req.file.mimetype;

    const fileBlock = mime === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
      : { type: 'image',    source: { type: 'base64', media_type: mime,               data: base64 } };

    const prompt = `Analizá este documento financiero y extraé todas las posiciones de inversión que encuentres.

Instrumentos disponibles en el sistema (intentá hacer coincidir por nombre o ticker):
${JSON.stringify(instruments.map(i => ({ id: i.id, name: i.alias || i.name, ticker: i.ticker })))}

Para cada posición devolvé un objeto con estos campos (omitir los que no apliquen, no poner null explícito):
- instrument_name: nombre tal como aparece en el documento
- instrument_id: id del instrumento del sistema si encontrás coincidencia clara
- units: número de cuotas o unidades (si la posición es en unidades)
- amount_clp: monto en pesos chilenos como número entero (si la posición es en CLP)
- amount_usd: monto en dólares como número (si la posición es en USD)
- notes: observación útil (ej: "Fondo Serie A", fecha de valorización, etc.)

Respondé ÚNICAMENTE con un array JSON válido, sin texto adicional, sin bloques markdown.`;

    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 2048,
      messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: prompt }] }],
    });

    const text = response.content.find(b => b.type === 'text')?.text?.trim() || '[]';
    let proposals = [];
    try { proposals = JSON.parse(text); } catch { proposals = []; }

    res.json({ proposals });
  } catch (e) {
    console.error('[ai/parse-cartola]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Chat tools ───────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'get_portfolio',
    description: 'Obtiene las posiciones actuales del portafolio con valores y porcentajes al día',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_movements',
    description: 'Obtiene el historial de aportes y retiros',
    input_schema: {
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
    input_schema: {
      type: 'object',
      properties: {
        date:       { type: 'string',  description: 'Fecha YYYY-MM-DD'            },
        type:       { type: 'string',  enum: ['aporte', 'retiro']                 },
        amount_clp: { type: 'number',  description: 'Monto en pesos chilenos'     },
        notes:      { type: 'string',  description: 'Descripción del movimiento'  },
      },
      required: ['date', 'type', 'amount_clp'],
    },
  },
  {
    name: 'add_to_position',
    description: 'Propone agregar o retirar de una posición existente y registrar el movimiento',
    input_schema: {
      type: 'object',
      properties: {
        instrument_name: { type: 'string', description: 'Nombre del instrumento tal como aparece en el portafolio' },
        type:         { type: 'string', enum: ['aporte', 'retiro']                         },
        delta:        { type: 'number', description: 'Cantidad a agregar/quitar (positivo)' },
        mode:         { type: 'string', enum: ['units', 'amount_clp', 'amount_usd'], description: 'Unidad del delta' },
        movement_clp: { type: 'number', description: 'Monto CLP para historial (si mode != amount_clp)' },
        date:         { type: 'string', description: 'Fecha YYYY-MM-DD'                    },
        notes:        { type: 'string' },
      },
      required: ['instrument_name', 'type', 'delta', 'mode', 'date'],
    },
  },
];

const WRITE_TOOLS = new Set(['create_movement', 'add_to_position']);

async function executeReadTool(name, input, userId) {
  if (name === 'get_portfolio') {
    return await computePositions(userId);
  }
  if (name === 'get_movements') {
    const clauses = ['user_id = $1']; const params = [userId];
    if (input.from) { params.push(input.from); clauses.push(`date >= $${params.length}`); }
    if (input.to)   { params.push(input.to);   clauses.push(`date <= $${params.length}`); }
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

async function resolveWriteTool(name, input, userId) {
  if (name === 'create_movement') {
    return { endpoint: 'create_movement', params: input };
  }
  if (name === 'add_to_position') {
    const { rows } = await query(
      `SELECT p.id, p.units, p.amount_clp, p.amount_usd, i.name, i.alias, i.ticker
       FROM positions p JOIN instruments i ON i.id = p.instrument_id
       WHERE p.user_id = $1
         AND (LOWER(i.name) LIKE $2 OR LOWER(COALESCE(i.alias,'')) LIKE $2 OR LOWER(COALESCE(i.ticker,'')) LIKE $2)
       LIMIT 1`,
      [userId, `%${input.instrument_name.toLowerCase()}%`]
    );
    return { endpoint: 'add_to_position', position: rows[0] || null, params: input };
  }
}

// ─── POST /api/ai/chat ────────────────────────────────────────────────────────
router.post('/chat', async (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages requerido' });
  }

  try {
    const client = getClient();
    const today  = new Date().toISOString().slice(0, 10);

    // Contexto del portafolio inyectado en el system prompt
    let portfolioCtx = '';
    try {
      const data = await computePositions(req.user.id);
      const resumen = data.positions.map(p => ({
        nombre: p.alias || p.name,
        tipo: p.type,
        valor_clp: Math.round(p.value_clp || 0),
        pct: `${(p.pct_portfolio || 0).toFixed(1)}%`,
        ...(p.units      != null ? { unidades: p.units }           : {}),
        ...(p.amount_clp != null ? { monto_clp: p.amount_clp }     : {}),
        ...(p.amount_usd != null ? { monto_usd: p.amount_usd }     : {}),
      }));
      portfolioCtx = `\nPortafolio actual (${today}):\nTotal CLP: $${Math.round(data.totalClp || 0).toLocaleString('es-CL')}\nPosiciones:\n${JSON.stringify(resumen, null, 2)}`;
    } catch { portfolioCtx = '\n(No se pudo cargar el portafolio)'; }

    const systemPrompt = `Sos un asistente financiero personal para una app de seguimiento de inversiones en Chile.
Respondés siempre en español. Sos directo, conciso y útil. La fecha de hoy es ${today}.
${portfolioCtx}

Podés responder preguntas sobre el portafolio, hacer análisis y recomendaciones, y proponer registrar movimientos usando las herramientas disponibles. El usuario siempre confirma antes de que se ejecute cualquier acción de escritura.`;

    let msgs = messages.map(m => ({ role: m.role, content: m.content }));

    // Loop agéntico: ejecutar read-tools automáticamente; parar en write-tool
    for (let iter = 0; iter < 6; iter++) {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 1024,
        system: systemPrompt,
        tools: TOOLS,
        messages: msgs,
      });

      if (response.stop_reason === 'end_turn') {
        const text = response.content.find(b => b.type === 'text')?.text || '';
        return res.json({ type: 'message', content: text });
      }

      if (response.stop_reason === 'tool_use') {
        const toolUses   = response.content.filter(b => b.type === 'tool_use');
        const writeTool  = toolUses.find(t => WRITE_TOOLS.has(t.name));

        if (writeTool) {
          const textBlock = response.content.find(b => b.type === 'text');
          const action    = await resolveWriteTool(writeTool.name, writeTool.input, req.user.id);
          return res.json({ type: 'proposal', action, message: textBlock?.text || '' });
        }

        // Read tools: ejecutar y continuar conversación
        const toolResults = [];
        for (const tu of toolUses) {
          const result = await executeReadTool(tu.name, tu.input, req.user.id);
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) });
        }
        msgs = [...msgs, { role: 'assistant', content: response.content }, { role: 'user', content: toolResults }];
      }
    }

    res.json({ type: 'message', content: 'No pude procesar la consulta. Intentá de nuevo.' });
  } catch (e) {
    console.error('[ai/chat]', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
