-- ============================================================================
-- FASE 2 (§3.3) — índice de position_snapshots por fecha
--
-- El snapshot diario set-based hace tres pasadas filtrando por `date`:
--   - el DELETE de filas huérfanas del día
--   - la agregación a portfolio_snapshots
--   - (y el UPSERT, que va por la PK y no necesita nada)
--
-- Los índices que dejó la migración 002 son (user_id, date, ...) y
-- (user_id, instrument_id, date): en ninguno `date` es la columna líder, así
-- que un filtro `WHERE date = $1` sin user_id no puede usarlos y termina en
-- seq scan de toda la tabla. Justo la tabla que crece por usuario × activo ×
-- día, o sea la única que no puede permitirse un scan diario completo.
--
-- (date, user_id) sirve para los dos casos: el barrido global del cron y el
-- acotado a un usuario que usan las rutas.
--
-- EJECUCIÓN: correr en el SQL Editor de Supabase. Es idempotente.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_possnap_date_user
  ON position_snapshots (date, user_id);

-- Que el planner tenga estadísticas frescas para elegirlo.
ANALYZE position_snapshots;
