// Movimientos (aportes y retiros) del usuario autenticado.
//
// Ahora viven en `transactions` junto con los saldos. Esta ruta expone solo los
// deltas y mantiene el nombre `type` que espera el frontend, para no romper
// Movimientos.jsx ni las tools del chat mientras se migra el resto.
import { Router } from 'express';
import { query } from '../config/db.js';
import { computeAndSaveSnapshot } from '../services/portfolioService.js';
import { NO_CUSTODIAN, recordMovement, rebuildPosition, deleteTransaction } from '../services/ledgerService.js';

const router = Router();

// GET /api/movements?from=&to=&instrument_id=&type=aporte|retiro
router.get('/', async (req, res) => {
  const { from, to, instrument_id, type } = req.query;
  const clauses = ["t.user_id = $1", "t.kind IN ('aporte','retiro')"];
  const params = [req.user.id];
  if (from) { params.push(from); clauses.push(`t.date >= $${params.length}`); }
  if (to)   { params.push(to);   clauses.push(`t.date <= $${params.length}`); }
  if (instrument_id) { params.push(instrument_id); clauses.push(`t.instrument_id = $${params.length}`); }
  if (type) { params.push(type); clauses.push(`t.kind = $${params.length}`); }

  // LEFT JOIN a instruments porque instrument_id sigue pudiendo ser NULL:
  // son los aportes a nivel portafolio, sin instrumento específico.
  const { rows } = await query(
    `SELECT t.id, t.user_id, t.instrument_id, t.custodian_id, t.date,
            t.kind AS type, t.amount_clp, t.amount_usd, t.units, t.notes,
            t.source, t.created_at,
            i.name AS instrument_name, i.type AS instrument_type,
            c.name AS custodian_name
     FROM transactions t
     LEFT JOIN instruments i ON i.id = t.instrument_id
     LEFT JOIN custodians  c ON c.id = t.custodian_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY t.date DESC, t.id DESC`,
    params
  );
  res.json(rows);
});

// POST /api/movements  { instrument_id?, custodian_id?, date, type, amount_clp?, amount_usd?, notes? }
router.post('/', async (req, res) => {
  const { instrument_id, custodian_id, date, type, amount_clp, amount_usd, units, notes } = req.body;

  if (!date || !type) return res.status(400).json({ error: 'date y type son obligatorios' });
  if (!['aporte', 'retiro'].includes(type)) {
    return res.status(400).json({ error: "type debe ser 'aporte' o 'retiro'" });
  }

  try {
    const mov = await recordMovement({
      userId:       req.user.id,
      custodianId:  custodian_id ?? NO_CUSTODIAN,
      instrumentId: instrument_id ?? null,
      date,
      kind:         type,
      units:        units      ?? null,
      amountClp:    amount_clp ?? null,
      amountUsd:    amount_usd ?? null,
      notes:        notes      ?? null,
    });

    // Regenerar el snapshot del día del movimiento para que el TWR sea preciso.
    try { await computeAndSaveSnapshot(req.user.id, date); } catch { /* no bloquear */ }

    res.status(201).json({ ...mov, type: mov.kind });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/movements/:id
router.put('/:id', async (req, res) => {
  const { date, type, amount_clp, amount_usd, notes } = req.body;
  if (type && !['aporte', 'retiro'].includes(type)) {
    return res.status(400).json({ error: "type debe ser 'aporte' o 'retiro'" });
  }

  const { rows } = await query(
    `UPDATE transactions
       SET date       = COALESCE($3, date),
           kind       = COALESCE($4, kind),
           amount_clp = $5,
           amount_usd = $6,
           notes      = $7
     WHERE id = $1 AND user_id = $2 AND kind IN ('aporte','retiro')
     RETURNING *`,
    [req.params.id, req.user.id, date ?? null, type ?? null,
     amount_clp ?? null, amount_usd ?? null, notes ?? null]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Movimiento no encontrado' });

  // Editar un movimiento cambia la posición derivada, no solo el historial.
  if (rows[0].instrument_id) {
    await rebuildPosition(req.user.id, rows[0].custodian_id, rows[0].instrument_id);
  }
  try { await computeAndSaveSnapshot(req.user.id, rows[0].date); } catch { /* no bloquear */ }

  res.json({ ...rows[0], type: rows[0].kind });
});

// DELETE /api/movements/:id
router.delete('/:id', async (req, res) => {
  const ok = await deleteTransaction(req.user.id, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Movimiento no encontrado' });
  res.status(204).end();
});

export default router;
