// CRUD de instrumentos (global). Lectura para cualquier usuario; escritura libre
// en v1 (single-owner). En multi-usuario real, restringir POST/PUT/DELETE a admin.
import { Router } from 'express';
import { query } from '../config/db.js';

const router = Router();

// GET /api/instruments
router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, alias, type, ticker, currency, api_source, external_id, meta, created_at
     FROM instruments ORDER BY type, name`
  );
  res.json(rows);
});

// POST /api/instruments
router.post('/', async (req, res) => {
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

// PUT /api/instruments/:id
router.put('/:id', async (req, res) => {
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

// DELETE /api/instruments/:id  (cascade a prices y positions)
router.delete('/:id', async (req, res) => {
  const { rowCount } = await query('DELETE FROM instruments WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Instrumento no encontrado' });
  res.status(204).end();
});

export default router;
