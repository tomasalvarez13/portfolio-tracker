// Posiciones del usuario autenticado.
//
// `positions` ya no se escribe directo: es una caché derivada de `transactions`.
// Todo lo que antes era un UPDATE acá ahora es un evento en el ledger seguido de
// un rebuild. Ver services/ledgerService.js.
import { Router } from 'express';
import { computePositions, computeAndSaveSnapshot } from '../services/portfolioService.js';
import {
  NO_CUSTODIAN, setBalance, recordMovement, closePosition, resolvePosition,
} from '../services/ledgerService.js';
import { todayCL } from '../utils/dates.js';

const router = Router();


/** Refresca el snapshot del día para que el resumen refleje el cambio al toque. */
async function refreshSnapshot(userId, date) {
  try { await computeAndSaveSnapshot(userId, date); } catch { /* no bloquear la respuesta */ }
}

// GET /api/positions
router.get('/', async (req, res) => {
  res.json(await computePositions(req.user.id));
});

// POST /api/positions  { instrument_id, custodian_id?, units? | amount_clp? | amount_usd?, date?, notes? }
//
// Declarar una posición es declarar un SALDO: "tengo X unidades de este activo
// en este custodio". Repetirlo el mismo día corrige el saldo en vez de sumarlo.
router.post('/', async (req, res) => {
  const { instrument_id, custodian_id, units, amount_clp, amount_usd, date, notes } = req.body;

  if (!instrument_id) return res.status(400).json({ error: 'instrument_id es obligatorio' });
  if (units == null && amount_clp == null && amount_usd == null) {
    return res.status(400).json({ error: 'Indica units, amount_clp o amount_usd' });
  }

  const when = date || todayCL();
  try {
    await setBalance({
      userId:       req.user.id,
      custodianId:  custodian_id ?? NO_CUSTODIAN,
      instrumentId: instrument_id,
      date:         when,
      units:        units      ?? null,
      amountClp:    amount_clp ?? null,
      amountUsd:    amount_usd ?? null,
      notes:        notes      ?? null,
      supersede:    true,
    });
    await refreshSnapshot(req.user.id, when);

    const { positions } = await computePositions(req.user.id);
    const created = positions.find(
      (p) => p.instrument_id === Number(instrument_id)
        && p.custodian_id === (custodian_id ?? NO_CUSTODIAN)
    );
    res.status(201).json(created || null);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/positions/:id  -> corrige el saldo de una posición existente
router.put('/:id', async (req, res) => {
  const { units, amount_clp, amount_usd, date, notes } = req.body;

  const pos = await resolvePosition(req.user.id, req.params.id);
  if (!pos) return res.status(404).json({ error: 'Posición no encontrada' });

  const when = date || todayCL();
  try {
    await setBalance({
      userId:       req.user.id,
      custodianId:  pos.custodian_id,
      instrumentId: pos.instrument_id,
      date:         when,
      units:        units      ?? null,
      amountClp:    amount_clp ?? null,
      amountUsd:    amount_usd ?? null,
      notes:        notes      ?? null,
      supersede:    true,
    });
    await refreshSnapshot(req.user.id, when);

    const updated = await resolvePosition(req.user.id, req.params.id);
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/positions/:id/aporte
// { delta_units? | delta_amount_clp? | delta_amount_usd?, movement_clp?, date?, notes?, type }
//
// Un delta sobre la posición. A diferencia de antes, el movimiento se guarda CON
// su instrument_id y su custodian_id: sin eso no hay rentabilidad por activo ni
// por custodio, porque no hay flujos atribuibles a cada bucket.
router.post('/:id/aporte', async (req, res) => {
  const {
    delta_units, delta_amount_clp, delta_amount_usd,
    movement_clp, date, notes, type = 'aporte',
  } = req.body;

  if (!['aporte', 'retiro'].includes(type)) {
    return res.status(400).json({ error: "type debe ser 'aporte' o 'retiro'" });
  }
  if (delta_units == null && delta_amount_clp == null && delta_amount_usd == null) {
    return res.status(400).json({ error: 'Indica delta_units, delta_amount_clp o delta_amount_usd' });
  }

  const pos = await resolvePosition(req.user.id, req.params.id);
  if (!pos) return res.status(404).json({ error: 'Posición no encontrada' });

  const when = date || todayCL();

  // El monto CLP del movimiento: si el delta ya viene en CLP lo usamos; si no,
  // el frontend manda su equivalente para que el historial de aportes cuadre.
  const clpForMovement = delta_amount_clp != null
    ? Number(delta_amount_clp)
    : (movement_clp != null ? Number(movement_clp) : null);

  try {
    const movement = await recordMovement({
      userId:       req.user.id,
      custodianId:  pos.custodian_id,
      instrumentId: pos.instrument_id,
      date:         when,
      kind:         type,
      units:        delta_units      != null ? Number(delta_units)      : null,
      amountClp:    clpForMovement,
      amountUsd:    delta_amount_usd != null ? Number(delta_amount_usd) : null,
      notes:        notes ?? null,
    });
    await refreshSnapshot(req.user.id, when);

    const position = await resolvePosition(req.user.id, req.params.id);
    res.status(201).json({ position, movement });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/positions/:id
//
// Cierra la posición declarando saldo cero. La fila de `positions` desaparece,
// pero el historial queda en el ledger — que es justamente para lo que está.
router.delete('/:id', async (req, res) => {
  const pos = await resolvePosition(req.user.id, req.params.id);
  if (!pos) return res.status(404).json({ error: 'Posición no encontrada' });

  const when = todayCL();
  try {
    await closePosition({
      userId:       req.user.id,
      custodianId:  pos.custodian_id,
      instrumentId: pos.instrument_id,
      date:         when,
    });
    await refreshSnapshot(req.user.id, when);
    res.status(204).end();
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
