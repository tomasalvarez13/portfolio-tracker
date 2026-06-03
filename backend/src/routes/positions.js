// CRUD de posiciones del usuario autenticado, con valor actual calculado.
import { Router } from 'express';
import { query } from '../config/db.js';
import { computePositions, computeAndSaveSnapshot } from '../services/portfolioService.js';

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

// POST /api/positions/:id/aporte — suma (aporte) o resta (retiro) un delta y registra el movimiento.
router.post('/:id/aporte', async (req, res) => {
  const { delta_units, delta_amount_clp, delta_amount_usd, movement_clp, date, notes, type = 'aporte' } = req.body;
  if (!['aporte', 'retiro'].includes(type)) {
    return res.status(400).json({ error: "type debe ser 'aporte' o 'retiro'" });
  }
  const sign = type === 'retiro' ? -1 : 1;

  const { rows: [pos] } = await query(
    'SELECT * FROM positions WHERE id=$1 AND user_id=$2',
    [req.params.id, req.user.id]
  );
  if (!pos) return res.status(404).json({ error: 'Posición no encontrada' });

  if (delta_units == null && delta_amount_clp == null && delta_amount_usd == null) {
    return res.status(400).json({ error: 'Indica delta_units, delta_amount_clp o delta_amount_usd' });
  }

  const newUnits      = delta_units      != null ? Number(pos.units      || 0) + sign * Number(delta_units)      : pos.units;
  const newAmountClp  = delta_amount_clp != null ? Number(pos.amount_clp || 0) + sign * Number(delta_amount_clp) : pos.amount_clp;
  const newAmountUsd  = delta_amount_usd != null ? Number(pos.amount_usd || 0) + sign * Number(delta_amount_usd) : pos.amount_usd;

  const { rows: [updatedPos] } = await query(
    `UPDATE positions SET units=$3, amount_clp=$4, amount_usd=$5, updated_at=NOW()
     WHERE id=$1 AND user_id=$2 RETURNING *`,
    [req.params.id, req.user.id, newUnits, newAmountClp, newAmountUsd]
  );

  // El monto CLP del movimiento: si el delta ya es CLP lo usamos directamente; si no, el frontend lo provee.
  const clpForMovement = delta_amount_clp != null ? Number(delta_amount_clp) : (movement_clp != null ? Number(movement_clp) : null);
  const movDate = date || new Date().toISOString().slice(0, 10);
  let movement = null;
  if (clpForMovement != null) {
    const { rows: [mov] } = await query(
      `INSERT INTO movements (user_id, instrument_id, date, type, amount_clp, notes)
       VALUES ($1, NULL, $2, $3, $4, $5) RETURNING *`,
      [req.user.id, movDate, type, clpForMovement, notes ?? null]
    );
    movement = mov;
  }
  // Siempre recalcular snapshot para reflejar el cambio de posición en el resumen.
  try { await computeAndSaveSnapshot(req.user.id, movDate); } catch {}

  res.status(201).json({ position: updatedPos, movement });
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
