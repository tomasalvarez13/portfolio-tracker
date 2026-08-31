// Cartolas: guardado, matching contra el maestro y confirmación al ledger.
//
// El flujo tiene dos pasos separados a propósito:
//
//   1. subir  → se guarda el archivo (hash) y lo que el modelo extrajo, y se le
//               adjuntan candidatos del maestro a cada fila. No escribe nada del
//               portafolio.
//   2. confirmar → el usuario revisa, corrige y confirma. Recién ahí se escribe
//               al ledger, todo en una transacción.
//
// Entre medio la cartola queda guardada, así que se puede reprocesar sin volver
// a gastar una llamada al modelo, y se puede auditar de dónde salió cada saldo.

import crypto from 'crypto';
import { query, withTransaction } from '../config/db.js';
import { setBalance, NO_CUSTODIAN } from './ledgerService.js';

export const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

/**
 * Candidatos del maestro para un texto de cartola.
 * Delega en match_instruments (pg_trgm), ver migración 004.
 */
export async function matchCandidates(userId, text, limit = 8) {
  if (!text) return [];
  const { rows } = await query(
    'SELECT * FROM match_instruments($1, $2, $3)',
    [text, userId, limit]
  );
  return rows.map((r) => ({ ...r, similarity: Number(r.similarity) }));
}

/**
 * Adivina el custodio a partir del nombre que trae la cartola.
 *
 * Delega en match_custodian() en vez de armar la query acá: los operadores de
 * pg_trgm dependen del search_path, y el del rol con que se conecta el backend
 * no está garantizado (en Supabase pg_trgm vive en el schema `extensions`). La
 * función lo fija.
 */
export async function matchCustodian(name) {
  if (!name) return null;
  const { rows } = await query('SELECT * FROM match_custodian($1)', [name]);
  return rows[0] ?? null;
}

/**
 * Guarda la cartola y devuelve las filas con sus candidatos.
 *
 * El hash da idempotencia: resubir el mismo archivo devuelve la cartola que ya
 * estaba en vez de crear otra. Si ya fue confirmada, se avisa — pero igual se
 * deja reconfirmar, porque a veces se corrige una fila y se vuelve a mandar.
 */
export async function saveStatement({
  userId, custodianId, fileHash, fileName, parsed,
}) {
  const { rows: [stmt] } = await query(
    `INSERT INTO statements
       (user_id, custodian_id, file_hash, file_name, statement_date, status, raw_parse, rows_proposed)
     VALUES ($1, $2, $3, $4, $5, 'parsed', $6, $7)
     ON CONFLICT (user_id, file_hash)
     DO UPDATE SET custodian_id   = EXCLUDED.custodian_id,
                   statement_date = EXCLUDED.statement_date,
                   raw_parse      = EXCLUDED.raw_parse,
                   rows_proposed  = EXCLUDED.rows_proposed
     RETURNING *`,
    [userId, custodianId ?? NO_CUSTODIAN, fileHash, fileName ?? null,
     parsed.statement_date, JSON.stringify(parsed), parsed.rows.length]
  );
  return stmt;
}

/** Cada fila extraída, con los candidatos del maestro que le corresponden. */
export async function withCandidates(userId, rows) {
  return Promise.all(rows.map(async (r) => ({
    ...r,
    candidates: await matchCandidates(userId, r.instrument_name),
  })));
}

/**
 * Confirma una cartola: escribe los saldos al ledger.
 *
 * Cada fila puede venir de tres formas:
 *   - instrument_id            → activo existente del maestro
 *   - create_instrument: true  → alta de un activo pending_mapping
 *   - ninguna de las dos       → se ignora (el usuario la rechazó o no la asignó)
 *
 * Todo va en una transacción: si la fila 4 falla, las 3 primeras no quedan
 * aplicadas. Antes eran N requests sueltas desde el browser, cada una con su
 * propio recálculo de snapshot.
 *
 * Los saldos van con la FECHA DE LA CARTOLA, no la de hoy, y con supersede en
 * false: reprocesar la misma cartola da el mismo resultado y no descarta los
 * aportes que el usuario haya cargado ese mismo día.
 */
export async function confirmStatement({ userId, statementId, rows, date }) {
  const { rows: [stmt] } = await query(
    'SELECT * FROM statements WHERE id = $1 AND user_id = $2',
    [statementId, userId]
  );
  if (!stmt) return { error: 'Cartola no encontrada' };

  const when = date || (stmt.statement_date
    ? new Date(stmt.statement_date).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10));

  const custodianId = stmt.custodian_id ?? NO_CUSTODIAN;

  return withTransaction(async (q) => {
    const applied = [];
    const created = [];

    for (const r of rows || []) {
      const units = r.units      != null ? Number(r.units)      : null;
      const clp   = r.amount_clp != null ? Number(r.amount_clp) : null;
      const usd   = r.amount_usd != null ? Number(r.amount_usd) : null;
      if (units == null && clp == null && usd == null) continue;

      let instrumentId = r.instrument_id ? Number(r.instrument_id) : null;

      // Activo que no está en el maestro: entra como pending_mapping. Se puede
      // trackear por monto desde ya, y queda en la cola admin para que le
      // asignen fuente de datos. Cuando eso pase, el cron lo toma solo.
      if (!instrumentId && r.create_instrument) {
        const name = String(r.instrument_name || '').trim().slice(0, 100);
        if (!name) continue;
        const { rows: [inst] } = await q(
          `INSERT INTO instruments (name, type, currency, api_source, status, created_by, meta)
           VALUES ($1, $2, $3, 'manual', 'pending_mapping', $4, $5)
           RETURNING id, name`,
          [name,
           r.type || 'fondo_mutuo_cl',
           usd != null ? 'USD' : 'CLP',
           userId,
           JSON.stringify({ origen: 'cartola', statement_id: statementId, texto_original: r.instrument_name })]
        );
        instrumentId = inst.id;
        created.push(inst);
      }

      if (!instrumentId) continue;

      await setBalance({
        userId, custodianId, instrumentId, date: when,
        units, amountClp: clp, amountUsd: usd,
        notes: r.notes ?? null,
        source: 'cartola',
        statementId,
        supersede: false,
        q,
      });
      applied.push(instrumentId);
    }

    await q(
      `UPDATE statements
       SET status = 'confirmed', confirmed_at = NOW(), rows_confirmed = $3
       WHERE id = $1 AND user_id = $2`,
      [statementId, userId, applied.length]
    );

    return { statement_id: statementId, date: when, applied: applied.length, created };
  });
}

/** Historial de cartolas del usuario. */
export async function listStatements(userId, limit = 50) {
  const { rows } = await query(
    `SELECT s.id, s.file_name, s.statement_date, s.status, s.created_at, s.confirmed_at,
            s.rows_proposed, s.rows_confirmed, c.name AS custodian_name
     FROM statements s
     LEFT JOIN custodians c ON c.id = s.custodian_id
     WHERE s.user_id = $1
     ORDER BY s.created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows;
}
