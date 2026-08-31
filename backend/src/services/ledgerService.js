// Ledger de transacciones: la única puerta de escritura a las posiciones.
//
// `transactions` es la fuente de verdad y `positions` una caché derivada. Nada
// escribe `positions` directamente: se inserta el evento acá y después se llama
// a rebuild_position(), que la recalcula desde el ledger.
//
// Dos tipos de evento:
//   - 'saldo'  → valor ABSOLUTO de la posición a esa fecha. Es lo que dice una
//                cartola, y lo que manda el usuario cuando declara "tengo X".
//   - deltas   → 'aporte', 'retiro', 'compra', 'venta', 'ajuste'.
//
// El rebuild toma el último 'saldo' como base y le aplica los deltas
// posteriores ordenados por (date, id). Ver migrations/002_fase1_fundaciones.sql.

import { query } from '../config/db.js';

// Todas las funciones aceptan `q`, una función de query. Por defecto usan el
// pool; confirmar una cartola les pasa la del cliente en transacción, para que
// las N escrituras sean atómicas. Ver withTransaction() en config/db.js.

/** Custodio centinela "sin custodio" (ver la migración). */
export const NO_CUSTODIAN = 0;

const KINDS_DELTA = ['aporte', 'retiro', 'compra', 'venta', 'ajuste'];

/** Recalcula una fila de `positions` desde el ledger. */
export async function rebuildPosition(userId, custodianId, instrumentId, q = query) {
  await q('SELECT rebuild_position($1, $2, $3)', [userId, custodianId, instrumentId]);
}

/** Recalcula todas las posiciones de un usuario. Idempotente. */
export async function rebuildPositionsForUser(userId) {
  const { rows } = await query('SELECT rebuild_positions_for_user($1) AS n', [userId]);
  return Number(rows[0]?.n || 0);
}

/**
 * Declara el saldo absoluto de una posición a una fecha.
 *
 * Un solo saldo por (usuario, custodio, activo, fecha): volver a declarar el
 * mismo día sobreescribe en vez de acumular, que es lo que hace falta para
 * reprocesar una cartola sin duplicar.
 *
 * `supersede` decide qué pasa con los deltas YA registrados en la misma fecha.
 * El rebuild aplica los deltas con (date, id) > (saldo.date, saldo.id), y un
 * upsert conserva el id original del saldo — así que un aporte cargado después
 * del saldo, el mismo día, queda con id mayor y se sigue sumando encima.
 *
 *   supersede = false  el saldo se actualiza en su lugar y los deltas del mismo
 *                      día se mantienen. Es lo que necesita reprocesar una
 *                      cartola: el resultado no depende de cuántas veces corra.
 *   supersede = true   el saldo se reinserta con id nuevo (el más alto del
 *                      bucket) y los deltas previos del día quedan detrás, o
 *                      sea descartados. Es lo que significa que el usuario
 *                      declare "hoy tengo exactamente X".
 */
export async function setBalance({
  userId, custodianId = NO_CUSTODIAN, instrumentId, date,
  units = null, amountClp = null, amountUsd = null,
  notes = null, source = 'manual', statementId = null,
  supersede = false, q = query,
}) {
  if (!instrumentId) throw new Error('instrumentId es obligatorio para un saldo');

  if (supersede) {
    await q(
      `DELETE FROM transactions
       WHERE user_id = $1 AND custodian_id = $2 AND instrument_id = $3
         AND date = $4 AND kind = 'saldo'`,
      [userId, custodianId, instrumentId, date]
    );
  }

  const { rows } = await q(
    `INSERT INTO transactions
       (user_id, custodian_id, instrument_id, statement_id, date, kind,
        units, amount_clp, amount_usd, notes, source)
     VALUES ($1,$2,$3,$4,$5,'saldo',$6,$7,$8,$9,$10)
     ON CONFLICT (user_id, custodian_id, instrument_id, date) WHERE kind = 'saldo'
     DO UPDATE SET units       = EXCLUDED.units,
                   amount_clp  = EXCLUDED.amount_clp,
                   amount_usd  = EXCLUDED.amount_usd,
                   notes       = EXCLUDED.notes,
                   source      = EXCLUDED.source,
                   statement_id = EXCLUDED.statement_id
     RETURNING *`,
    [userId, custodianId, instrumentId, statementId, date,
     units, amountClp, amountUsd, notes, source]
  );

  await rebuildPosition(userId, custodianId, instrumentId, q);
  return rows[0];
}

/**
 * Registra un movimiento delta. `instrumentId` null = movimiento a nivel
 * portafolio (el aporte genérico que antes vivía en `movements`).
 */
export async function recordMovement({
  userId, custodianId = NO_CUSTODIAN, instrumentId = null, date, kind,
  units = null, price = null, amountClp = null, amountUsd = null,
  notes = null, source = 'manual', statementId = null, q = query,
}) {
  if (!KINDS_DELTA.includes(kind)) {
    throw new Error(`kind inválido: ${kind}. Esperaba uno de ${KINDS_DELTA.join(', ')}`);
  }

  const { rows } = await q(
    `INSERT INTO transactions
       (user_id, custodian_id, instrument_id, statement_id, date, kind,
        units, price, amount_clp, amount_usd, notes, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [userId, custodianId, instrumentId, statementId, date, kind,
     units, price, amountClp, amountUsd, notes, source]
  );

  // Solo las transacciones con instrumento afectan una posición.
  if (instrumentId) await rebuildPosition(userId, custodianId, instrumentId, q);
  return rows[0];
}

/**
 * Cierra una posición: declara saldo cero. El rebuild borra la fila de
 * `positions`, pero el historial queda intacto en el ledger — que es la razón
 * de tener un ledger.
 */
export async function closePosition({ userId, custodianId, instrumentId, date, notes = null, q = query }) {
  // supersede: cerrar significa "acá no queda nada", así que también descarta
  // los deltas que se hayan cargado el mismo día antes del cierre.
  return setBalance({
    userId, custodianId, instrumentId, date,
    units: 0, amountClp: 0, amountUsd: 0,
    notes: notes ?? 'Posición cerrada',
    supersede: true, q,
  });
}

/** Elimina una transacción del ledger y recalcula lo que tocaba. */
export async function deleteTransaction(userId, txId) {
  const { rows } = await query(
    'DELETE FROM transactions WHERE id = $1 AND user_id = $2 RETURNING custodian_id, instrument_id',
    [txId, userId]
  );
  if (!rows[0]) return false;
  if (rows[0].instrument_id) {
    await rebuildPosition(userId, rows[0].custodian_id, rows[0].instrument_id);
  }
  return true;
}

/**
 * Mueve una posición de un custodio a otro, conservando el ledger.
 *
 * No es un "editar el campo": `positions` es derivada, así que lo que se mueve
 * son las transacciones y la historia. Si el usuario ya tenía ese activo en el
 * destino, los saldos que coinciden en fecha se suman — son la misma tenencia.
 */
export async function movePositionCustodian({ userId, instrumentId, from, to }) {
  const { rows } = await query(
    'SELECT * FROM move_position_custodian($1, $2, $3, $4)',
    [userId, instrumentId, from, to]
  );
  return rows[0];
}

/** Resuelve (custodio, activo) desde el id de una fila de `positions`. */
export async function resolvePosition(userId, positionId) {
  const { rows } = await query(
    `SELECT id, custodian_id, instrument_id, units, amount_clp, amount_usd
     FROM positions WHERE id = $1 AND user_id = $2`,
    [positionId, userId]
  );
  return rows[0] || null;
}
