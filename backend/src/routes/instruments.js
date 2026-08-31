// Instrumentos: el maestro global.
//
// Lectura para cualquier usuario autenticado; escritura solo admin. Hasta la
// §3.4 la escritura estaba abierta a cualquiera con sesión, y como el DELETE
// cascadea a prices, positions, transactions y position_snapshots, un usuario
// podía borrar un instrumento y llevarse el historial de todos.
import { Router } from 'express';
import { query } from '../config/db.js';
import { requireAdmin } from '../config/auth.js';

const router = Router();

// GET /api/instruments
router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, alias, type, ticker, currency, api_source, external_id, meta, created_at
     FROM instruments ORDER BY type, name`
  );
  res.json(rows);
});

// POST /api/instruments  (admin)
router.post('/', requireAdmin, async (req, res) => {
  const { name, alias, type, ticker, currency, api_source, external_id, meta } = req.body;
  if (!name || !type || !currency || !api_source) {
    return res.status(400).json({ error: 'name, type, currency y api_source son obligatorios' });
  }
  const { rows } = await query(
    `INSERT INTO instruments (name, alias, type, ticker, currency, api_source, external_id, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'{}'::jsonb)) RETURNING *`,
    [name, alias ?? null, type, ticker ?? null, currency, api_source, external_id ?? null, meta ? JSON.stringify(meta) : null]
  );
  res.status(201).json(rows[0]);
});

// PUT /api/instruments/:id  (admin)
router.put('/:id', requireAdmin, async (req, res) => {
  const { name, alias, type, ticker, currency, api_source, external_id, meta } = req.body;
  const { rows } = await query(
    `UPDATE instruments SET
       name = COALESCE($2, name),
       alias = $3,
       type = COALESCE($4, type),
       ticker = $5,
       currency = COALESCE($6, currency),
       api_source = COALESCE($7, api_source),
       external_id = $8,
       meta = COALESCE($9, meta)
     WHERE id = $1 RETURNING *`,
    [req.params.id, name, alias ?? null, type, ticker ?? null, currency, api_source, external_id ?? null, meta ? JSON.stringify(meta) : null]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Instrumento no encontrado' });
  res.json(rows[0]);
});

// DELETE /api/instruments/:id  (admin)
//
// Solo si el instrumento no tiene historial. Con canonical_id en su lugar,
// borrar casi nunca es lo correcto: fusionar preserva los precios y las
// posiciones, y borrar cascadea a prices, positions, transactions y
// position_snapshots de TODOS los usuarios.
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { rows: [uso] } = await query(
      `SELECT (SELECT count(*) FROM transactions WHERE instrument_id = $1)::int AS tx,
              (SELECT count(*) FROM positions    WHERE instrument_id = $1)::int AS pos`,
      [req.params.id]
    );
    if (uso.tx > 0 || uso.pos > 0) {
      return res.status(409).json({
        error: 'El instrumento tiene historial y no se puede borrar. Fusionalo con otro o marcalo como deprecated.',
        transacciones: uso.tx,
        posiciones: uso.pos,
      });
    }
    const { rowCount } = await query('DELETE FROM instruments WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Instrumento no encontrado' });
    res.status(204).end();
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
