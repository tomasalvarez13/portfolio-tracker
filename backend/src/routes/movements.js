// CRUD de movimientos (aportes/retiros) del usuario autenticado.
import { Router } from 'express';
import { query } from '../config/db.js';

const router = Router();

// GET /api/movements?from=&to=&instrument_id=&type=aporte|retiro
router.get('/', async (req, res) => {
  const { from, to, instrument_id, type } = req.query;
  const clauses = ['m.user_id = $1'];
  const params = [req.user.id];
  if (from) { params.push(from); clauses.push(`m.date >= $${params.length}`); }
  if (to)   { params.push(to);   clauses.push(`m.date <= $${params.length}`); }
  if (instrument_id) { params.push(instrument_id); clauses.push(`m.instrument_id = $${params.length}`); }
  if (type) { params.push(type); clauses.push(`m.type = $${params.length}`); }

  // LEFT JOIN porque instrument_id puede ser NULL (movimientos a nivel portafolio)
  const { rows } = await query(
    `SELECT m.*, i.name AS instrument_name, i.type AS instrument_type
     FROM movements m LEFT JOIN instruments i ON i.id = m.instrument_id
     WHERE ${clauses.join(' AND ')} ORDER BY m.date DESC, m.id DESC`,
    params
  );
  res.json(rows);
});

// POST /api/movements  { instrument_id, date, type, amount_clp?, amount_usd?, notes? }
router.post('/', async (req, res) => {
  const { instrument_id, date, type, amount_clp, amount_usd, notes } = req.body;
  if (!instrument_id || !date || !type) {
    return res.status(400).json({ error: 'instrument_id, date y type son obligatorios' });
  }
  if (!['aporte', 'retiro'].includes(type)) {
    return res.status(400).json({ error: "type debe ser 'aporte' o 'retiro'" });
  }
  const { rows } = await query(
    `INSERT INTO movements (user_id, instrument_id, date, type, amount_clp, amount_usd, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.user.id, instrument_id, date, type, amount_clp ?? null, amount_usd ?? null, notes ?? null]
  );
  res.status(201).json(rows[0]);
});

// PUT /api/movements/:id
router.put('/:id', async (req, res) => {
  const { date, type, amount_clp, amount_usd, notes } = req.body;
  const { rows } = await query(
    `UPDATE movements SET date=COALESCE($3,date), type=COALESCE($4,type),
       amount_clp=$5, amount_usd=$6, notes=$7
     WHERE id=$1 AND user_id=$2 RETURNING *`,
    [req.params.id, req.user.id, date, type, amount_clp ?? null, amount_usd ?? null, notes ?? null]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Movimiento no encontrado' });
  res.json(rows[0]);
});

// DELETE /api/movements/:id
router.delete('/:id', async (req, res) => {
  const { rowCount } = await query(
    'DELETE FROM movements WHERE id=$1 AND user_id=$2',
    [req.params.id, req.user.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'Movimiento no encontrado' });
  res.status(204).end();
});

export default router;
