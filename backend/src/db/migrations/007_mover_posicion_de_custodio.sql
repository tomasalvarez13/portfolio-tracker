-- ============================================================================
-- Mover UNA posición de un custodio a otro
--
-- Las posiciones que existían antes de la Fase 1 quedaron todas en el centinela
-- "sin custodio", y hay que repartirlas. Hasta ahora la única salida era cerrar
-- la posición y crearla de nuevo en el custodio correcto, lo que parte el
-- historial en dos buckets y arruina las vistas de la Fase 3.
--
-- Es la misma idea que merge_custodians(), pero al grano de una posición: mueve
-- el ledger y reconstruye la caché, en vez de repuntar `positions` directo.
--
-- EJECUCIÓN: correr en el SQL Editor de Supabase. Idempotente.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION move_position_custodian(
  p_user       UUID,
  p_instrument INTEGER,
  p_from       INTEGER,
  p_to         INTEGER
)
RETURNS TABLE (transacciones INTEGER, saldos_sumados INTEGER, snapshots INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  n_tx     INTEGER := 0;
  n_merged INTEGER := 0;
  n_snap   INTEGER := 0;
BEGIN
  IF p_from = p_to THEN
    RAISE EXCEPTION 'El custodio de origen y el de destino son el mismo';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM custodians WHERE id = p_to AND canonical_id IS NULL) THEN
    RAISE EXCEPTION 'El custodio destino % no existe o está fusionado', p_to;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM transactions
    WHERE user_id = p_user AND instrument_id = p_instrument AND custodian_id = p_from
  ) THEN
    RAISE EXCEPTION 'No hay nada que mover: ese activo no tiene transacciones en ese custodio';
  END IF;

  -- Si el usuario YA tiene el mismo activo en el destino, mover de una violaría
  -- uq_tx_saldo cuando coinciden las fechas. Son la misma tenencia real, así
  -- que los saldos se suman. El CASE preserva NULL cuando ambos lo son: una
  -- posición por monto no tiene units, y convertirla en 0 cambiaría cómo la lee
  -- rebuild_position().
  UPDATE transactions t
     SET units      = CASE WHEN t.units      IS NULL AND src.units      IS NULL THEN NULL
                           ELSE COALESCE(t.units, 0)      + COALESCE(src.units, 0)      END,
         amount_clp = CASE WHEN t.amount_clp IS NULL AND src.amount_clp IS NULL THEN NULL
                           ELSE COALESCE(t.amount_clp, 0) + COALESCE(src.amount_clp, 0) END,
         amount_usd = CASE WHEN t.amount_usd IS NULL AND src.amount_usd IS NULL THEN NULL
                           ELSE COALESCE(t.amount_usd, 0) + COALESCE(src.amount_usd, 0) END
    FROM (
      SELECT date,
             SUM(units) AS units, SUM(amount_clp) AS amount_clp, SUM(amount_usd) AS amount_usd
      FROM transactions
      WHERE user_id = p_user AND instrument_id = p_instrument
        AND custodian_id = p_from AND kind = 'saldo'
      GROUP BY date
    ) src
   WHERE t.user_id = p_user AND t.instrument_id = p_instrument
     AND t.custodian_id = p_to AND t.kind = 'saldo'
     AND t.date = src.date;
  GET DIAGNOSTICS n_merged = ROW_COUNT;

  DELETE FROM transactions s
   WHERE s.user_id = p_user AND s.instrument_id = p_instrument
     AND s.custodian_id = p_from AND s.kind = 'saldo'
     AND EXISTS (
       SELECT 1 FROM transactions t
       WHERE t.user_id = p_user AND t.instrument_id = p_instrument
         AND t.custodian_id = p_to AND t.kind = 'saldo' AND t.date = s.date
     );

  UPDATE transactions SET custodian_id = p_to
   WHERE user_id = p_user AND instrument_id = p_instrument AND custodian_id = p_from;
  GET DIAGNOSTICS n_tx = ROW_COUNT;
  n_tx := n_tx + n_merged;

  -- La historia por activo se mueve igual, sumando donde colisiona: si no, el
  -- detalle dejaría de cuadrar con los portfolio_snapshots ya escritos.
  INSERT INTO position_snapshots
    (user_id, date, custodian_id, instrument_id, units, price_clp, value_clp, value_usd, is_stale)
  SELECT user_id, date, p_to, instrument_id, units, price_clp, value_clp, value_usd, is_stale
  FROM position_snapshots
  WHERE user_id = p_user AND instrument_id = p_instrument AND custodian_id = p_from
  ON CONFLICT (user_id, date, custodian_id, instrument_id) DO UPDATE
    SET units     = COALESCE(position_snapshots.units, 0)     + COALESCE(EXCLUDED.units, 0),
        value_clp = COALESCE(position_snapshots.value_clp, 0) + COALESCE(EXCLUDED.value_clp, 0),
        value_usd = COALESCE(position_snapshots.value_usd, 0) + COALESCE(EXCLUDED.value_usd, 0),
        is_stale  = position_snapshots.is_stale OR EXCLUDED.is_stale;
  GET DIAGNOSTICS n_snap = ROW_COUNT;

  DELETE FROM position_snapshots
   WHERE user_id = p_user AND instrument_id = p_instrument AND custodian_id = p_from;

  -- positions es derivada: se borra el origen y se reconstruyen los dos lados.
  DELETE FROM positions
   WHERE user_id = p_user AND instrument_id = p_instrument AND custodian_id = p_from;
  PERFORM rebuild_position(p_user, p_to, p_instrument);

  RETURN QUERY SELECT n_tx, n_merged, n_snap;
END $fn$;

REVOKE EXECUTE ON FUNCTION move_position_custodian(UUID, INTEGER, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;

COMMIT;

-- ============================================================================
-- Qué posiciones están todavía sin custodio:
--   SELECT i.name, p.units, p.amount_clp FROM positions p
--   JOIN instruments i ON i.id = p.instrument_id WHERE p.custodian_id = 0;
-- ============================================================================
