-- ============================================================================
-- FASE 2c (§3.4) — mantenedor admin
--
-- Dos piezas que no existen y que el panel necesita:
--
--   job_runs         una fila por ejecución del cron. `price_fetch_jobs` guarda
--                    estado por (instrumento, fecha), pero los jobs se reabren,
--                    se reintentan y se sobreescriben: mirando esa tabla no se
--                    puede responder "qué pasó en la corrida de las 8:30".
--
--   merge_custodians() `custodians` tiene canonical_id desde la 002 pero nunca
--                    se le hizo función ni UI. Como cualquier usuario puede
--                    crear custodios desde el form de posiciones, los
--                    duplicados van a aparecer solos.
--
-- EJECUCIÓN: correr completo en el SQL Editor de Supabase. Idempotente.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. EJECUCIONES DEL CRON
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_runs (
  id            BIGSERIAL PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('enqueue','run','refresh')),
  trigger       TEXT NOT NULL DEFAULT 'api'
                  CHECK (trigger IN ('cron','manual','api','job')),
  date          DATE,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  enqueued      INTEGER,
  claimed       INTEGER,
  ok            INTEGER,
  no_data       INTEGER,
  failed        INTEGER,
  pending_after INTEGER,
  error         TEXT,
  detail        JSONB
);

CREATE INDEX IF NOT EXISTS idx_job_runs_started ON job_runs (started_at DESC);

ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;
-- Sin políticas: solo el backend con la service key.

-- Qué jobs tocó cada corrida, para poder abrir una y ver su detalle.
ALTER TABLE price_fetch_jobs
  ADD COLUMN IF NOT EXISTS last_run_id BIGINT REFERENCES job_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_run ON price_fetch_jobs (last_run_id)
  WHERE last_run_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. FUSIONAR DOS CUSTODIOS
--
-- Misma idea que merge_instruments: se repunta el ledger y se reconstruye la
-- caché de posiciones, en vez de repuntar `positions` directo — que colisionaría
-- con la clave única cuando el usuario tiene el mismo activo en los dos
-- custodios.
--
-- Y el mismo cuidado con uq_tx_saldo: si el usuario tiene un saldo del mismo
-- activo en los dos custodios la misma fecha, repuntar de una viola el índice.
-- Son el mismo custodio real, así que los saldos se suman.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION merge_custodians(p_source INTEGER, p_target INTEGER)
RETURNS TABLE (transacciones INTEGER, saldos_sumados INTEGER, snapshots INTEGER, cartolas INTEGER, posiciones INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  n_tx     INTEGER := 0;
  n_merged INTEGER := 0;
  n_snap   INTEGER := 0;
  n_stmt   INTEGER := 0;
  n_pos    INTEGER := 0;
  r RECORD;
BEGIN
  IF p_source = p_target THEN
    RAISE EXCEPTION 'No se puede fusionar un custodio consigo mismo';
  END IF;
  IF p_source = 0 THEN
    RAISE EXCEPTION 'El centinela "sin custodio" no se puede fusionar';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM custodians WHERE id = p_target AND canonical_id IS NULL) THEN
    RAISE EXCEPTION 'El custodio destino % no existe o ya está fusionado', p_target;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _mc_users (user_id UUID, instrument_id INTEGER) ON COMMIT DROP;
  DELETE FROM _mc_users;
  INSERT INTO _mc_users
  SELECT DISTINCT user_id, instrument_id FROM transactions
  WHERE custodian_id IN (p_source, p_target) AND instrument_id IS NOT NULL;

  -- Saldos que van a colisionar: se suman al del destino.
  UPDATE transactions t
     SET units      = CASE WHEN t.units      IS NULL AND src.units      IS NULL THEN NULL
                           ELSE COALESCE(t.units, 0)      + COALESCE(src.units, 0)      END,
         amount_clp = CASE WHEN t.amount_clp IS NULL AND src.amount_clp IS NULL THEN NULL
                           ELSE COALESCE(t.amount_clp, 0) + COALESCE(src.amount_clp, 0) END,
         amount_usd = CASE WHEN t.amount_usd IS NULL AND src.amount_usd IS NULL THEN NULL
                           ELSE COALESCE(t.amount_usd, 0) + COALESCE(src.amount_usd, 0) END
    FROM (
      SELECT user_id, instrument_id, date,
             SUM(units) AS units, SUM(amount_clp) AS amount_clp, SUM(amount_usd) AS amount_usd
      FROM transactions
      WHERE custodian_id = p_source AND kind = 'saldo'
      GROUP BY user_id, instrument_id, date
    ) src
   WHERE t.custodian_id = p_target AND t.kind = 'saldo'
     AND t.user_id = src.user_id
     AND t.instrument_id IS NOT DISTINCT FROM src.instrument_id
     AND t.date = src.date;
  GET DIAGNOSTICS n_merged = ROW_COUNT;

  DELETE FROM transactions s
   WHERE s.custodian_id = p_source AND s.kind = 'saldo'
     AND EXISTS (
       SELECT 1 FROM transactions t
       WHERE t.custodian_id = p_target AND t.kind = 'saldo'
         AND t.user_id = s.user_id
         AND t.instrument_id IS NOT DISTINCT FROM s.instrument_id
         AND t.date = s.date
     );

  UPDATE transactions SET custodian_id = p_target WHERE custodian_id = p_source;
  GET DIAGNOSTICS n_tx = ROW_COUNT;
  n_tx := n_tx + n_merged;

  -- Historia por activo: sumar donde colisiona.
  INSERT INTO position_snapshots
    (user_id, date, custodian_id, instrument_id, units, price_clp, value_clp, value_usd, is_stale)
  SELECT user_id, date, p_target, instrument_id, units, price_clp, value_clp, value_usd, is_stale
  FROM position_snapshots WHERE custodian_id = p_source
  ON CONFLICT (user_id, date, custodian_id, instrument_id) DO UPDATE
    SET units     = COALESCE(position_snapshots.units, 0)     + COALESCE(EXCLUDED.units, 0),
        value_clp = COALESCE(position_snapshots.value_clp, 0) + COALESCE(EXCLUDED.value_clp, 0),
        value_usd = COALESCE(position_snapshots.value_usd, 0) + COALESCE(EXCLUDED.value_usd, 0),
        is_stale  = position_snapshots.is_stale OR EXCLUDED.is_stale;
  GET DIAGNOSTICS n_snap = ROW_COUNT;
  DELETE FROM position_snapshots WHERE custodian_id = p_source;

  UPDATE statements SET custodian_id = p_target WHERE custodian_id = p_source;
  GET DIAGNOSTICS n_stmt = ROW_COUNT;

  DELETE FROM positions WHERE custodian_id = p_source;
  FOR r IN SELECT DISTINCT user_id, instrument_id FROM _mc_users LOOP
    PERFORM rebuild_position(r.user_id, p_target, r.instrument_id);
    n_pos := n_pos + 1;
  END LOOP;

  UPDATE custodians SET canonical_id = p_target WHERE id = p_source;

  RETURN QUERY SELECT n_tx, n_merged, n_snap, n_stmt, n_pos;
END $fn$;

REVOKE EXECUTE ON FUNCTION merge_custodians(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;

COMMIT;

-- ============================================================================
-- VERIFICACIÓN
-- ============================================================================
--   SELECT * FROM job_runs ORDER BY started_at DESC LIMIT 10;
--   SELECT * FROM merge_custodians(<origen>, <destino>);
-- ============================================================================
