// Cartolas del usuario autenticado.
//
// Reemplaza el flujo viejo, que era: POST /api/ai/parse-cartola y después N
// llamadas sueltas a POST /api/positions desde el browser — cada una pisando la
// posición con ON CONFLICT DO UPDATE, sin registro del documento y sin custodio.
import { Router } from 'express';
import multer from 'multer';
import { query } from '../config/db.js';
import { parseCartolaFile } from '../services/cartolaParser.js';
import {
  sha256, saveStatement, withCandidates, matchCustodian,
  confirmStatement, listStatements,
} from '../services/statementService.js';
import { computeAndSaveSnapshot } from '../services/portfolioService.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const ok = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(null, ok);
  },
});

// GET /api/statements  -> historial
router.get('/', async (req, res) => {
  res.json(await listStatements(req.user.id));
});

// POST /api/statements   multipart: file, custodian_id?
//
// Sube, parsea, guarda y devuelve las filas con sus candidatos del maestro.
// No escribe nada del portafolio: eso pasa recién en /confirm.
router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibió archivo. Enviá un PDF o imagen.' });
  }

  try {
    const parsed = await parseCartolaFile(req.file.buffer, req.file.mimetype);

    // El custodio lo elige el usuario; si no lo mandó, se propone el que dice la
    // cartola. Nunca se adivina en silencio: la respuesta incluye la sugerencia
    // para que el frontend la muestre y el usuario confirme.
    const suggested = await matchCustodian(parsed.custodian_name);
    const custodianId = req.body?.custodian_id != null && req.body.custodian_id !== ''
      ? Number(req.body.custodian_id)
      : (suggested?.id ?? null);

    const stmt = await saveStatement({
      userId:   req.user.id,
      custodianId,
      fileHash: sha256(req.file.buffer),
      fileName: req.file.originalname,
      parsed,
    });

    res.status(201).json({
      statement: {
        id: stmt.id,
        custodian_id: stmt.custodian_id,
        statement_date: stmt.statement_date,
        status: stmt.status,
        file_name: stmt.file_name,
        rows_proposed: stmt.rows_proposed,
      },
      custodian_suggestion: suggested,
      custodian_name_detectado: parsed.custodian_name,
      rows: await withCandidates(req.user.id, parsed.rows),
    });
  } catch (e) {
    console.error('[statements:post]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/statements/:id  -> vuelve a proponer desde el raw_parse guardado,
// sin gastar otra llamada al modelo.
router.get('/:id', async (req, res) => {
  const { rows } = await query(
    `SELECT s.*, c.name AS custodian_name FROM statements s
     LEFT JOIN custodians c ON c.id = s.custodian_id
     WHERE s.id = $1 AND s.user_id = $2`,
    [req.params.id, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Cartola no encontrada' });

  const stmt = rows[0];
  const parsedRows = Array.isArray(stmt.raw_parse?.rows) ? stmt.raw_parse.rows : [];
  res.json({
    statement: stmt,
    rows: await withCandidates(req.user.id, parsedRows),
  });
});

// PUT /api/statements/:id  { custodian_id?, statement_date? }
router.put('/:id', async (req, res) => {
  const { custodian_id, statement_date } = req.body;
  const { rows } = await query(
    `UPDATE statements
     SET custodian_id   = COALESCE($3, custodian_id),
         statement_date = COALESCE($4, statement_date)
     WHERE id = $1 AND user_id = $2 RETURNING *`,
    [req.params.id, req.user.id, custodian_id ?? null, statement_date ?? null]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Cartola no encontrada' });
  res.json(rows[0]);
});

// POST /api/statements/:id/confirm   { rows: [...], date? }
//
// Un solo request para toda la cartola, en una transacción. Antes eran N
// requests, cada una recalculando el snapshot completo del portafolio.
router.post('/:id/confirm', async (req, res) => {
  const { rows, date } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows[] es obligatorio y debe ser un array no vacío' });
  }

  try {
    const result = await confirmStatement({
      userId: req.user.id, statementId: req.params.id, rows, date,
    });
    if (result?.error) return res.status(404).json({ error: result.error });

    // Un solo recálculo de snapshot al final, no uno por fila.
    try { await computeAndSaveSnapshot(req.user.id, result.date); } catch { /* no bloquear */ }

    res.json(result);
  } catch (e) {
    console.error('[statements:confirm]', e.message);
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/statements/:id
//
// Solo borra el registro de la cartola. Las transacciones que generó quedan en
// el ledger con statement_id en NULL: borrar el documento no puede hacer
// desaparecer plata del portafolio sin que el usuario lo pida explícitamente.
router.delete('/:id', async (req, res) => {
  const { rowCount } = await query(
    'DELETE FROM statements WHERE id = $1 AND user_id = $2',
    [req.params.id, req.user.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'Cartola no encontrada' });
  res.status(204).end();
});

export default router;
