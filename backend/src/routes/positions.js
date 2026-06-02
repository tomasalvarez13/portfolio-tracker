// CRUD de posiciones del usuario autenticado, con valor actual calculado.
import { Router } from 'express';
import { query } from '../config/db.js';
import { computePositions } from '../services/portfolioService.js';

const router = Router();

// GET /api/positions  -> posiciones con valor actual, % portafolio, fecha de precio
router.get('/', async (req, res) => {
  const data = await computePositions(req.user.id);
  res.json(data);
});

// POST /api/positions  { instrument_id, units? , amount_clp?, amount_usd?, notes? }
router.post('/', async (req, res) => {
  const { instrument_id, units, amount_clp, amount_usd, notes } = req.body;
  if (!instrument_id) return res.status(400).json({ error: 'instrument_id es obligatorio' });
  if (units == null && amount_clp == null && amount_usd == null) {
    return res.status(400).json({ error: 'Indica units, amount_clp o amount_usd' });
  }
  try {
    const { rows } = await query(
      `INSERT INTO positions (user_id, instrument_id, units, amount_clp, amount_usd, notes)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id, instrument_id)
       DO UPDATE SET units=$3, amount_clp=$4, amount_usd=$5, notes=$6, updated_at=NOW()
       RETURNING *`,
      [req.user.id, instrument_id, units ?? null, amount_clp ?? null, amount_usd ?? null, notes ?? null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/positions/:id
router.put('/:id', async (req, res) => {
  const { units, amount_clp, amount_usd, notes } = req.body;
  const { rows } = await query(
    `UPDATE positions SET units=$3, amount_clp=$4, amount_usd=$5, notes=$6, updated_at=NOW()
     WHERE id=$1 AND user_id=$2 RETURNING *`,
    [req.params.id, req.user.id, units ?? null, amount_clp ?? null, amount_usd ?? null, notes ?? null]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Posición no encontrada' });
  res.json(rows[0]);
});

// DELETE /api/positions/:id
router.delete('/:id', async (req, res) => {
  const { rowCount } = await query(
    'DELETE FROM positions WHERE id=$1 AND user_id=$2',
    [req.params.id, req.user.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'Posición no encontrada' });
  res.status(204).end();
});

export default router;
