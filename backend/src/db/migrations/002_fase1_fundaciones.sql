-- ============================================================================
-- FASE 1 — FUNDACIONES
--
-- Convierte el modelo de "estado actual" a "ledger de eventos":
--   transactions        fuente de verdad, append-only
--   positions           caché derivada del ledger (ya no se escribe a mano)
--   position_snapshots  historia por activo y custodio
--   custodians          maestro de custodios
--   statements          cartolas subidas, con hash para idempotencia
--
-- Es una migración ADITIVA: `movements` no se borra, se renombra y se reemplaza
-- por una vista del mismo nombre, así los 17 archivos que la leen siguen
-- funcionando sin cambios.
--
-- Decisiones tomadas (ver docs/plan-escalabilidad.md §6):
--   1. La cartola guarda un SALDO absoluto (kind='saldo'), no deltas.
--   2. El custodio va en positions y en su clave única. Un activo puede estar
--      en dos custodios. Los custodios creados por usuarios son globales.
--   3. transactions es la verdad; positions se recalcula desde el ledger.
--   4. movements pasa a ser vista sobre transactions.
--   5. position_snapshots arranca vacío (sin backfill).
--   6. Sin particionado por ahora.
--
-- EJECUCIÓN: correr completo en el SQL Editor de Supabase, en una sola pasada.
-- Es idempotente salvo el paso 8 (migración de datos), que está guardado con
-- un chequeo de source='migracion'.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. PREFLIGHT — abortar si el maestro ya tiene duplicados
--
-- Los índices únicos del paso 2 fallarían igual, pero con un mensaje ilegible.
-- Ojo: `seed.sql` usa `ON CONFLICT DO NOTHING` sin target, que sobre una tabla
-- cuyo único UNIQUE es el PK serial nunca dispara. Correrlo dos veces duplicó
-- todo. Si esto aborta, hay que decidir a mano qué fila es la canónica.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  dups TEXT;
BEGIN
  SELECT string_agg(format('%s / %s (ids: %s)', api_source, external_id, ids), E'\n  ')
    INTO dups
  FROM (
    SELECT api_source, external_id, string_agg(id::text, ',' ORDER BY id) AS ids
    FROM instruments
    WHERE external_id IS NOT NULL
    GROUP BY api_source, external_id
    HAVING COUNT(*) > 1
  ) d;

  IF dups IS NOT NULL THEN
    RAISE EXCEPTION E'Hay instrumentos duplicados por (api_source, external_id):\n  %\n\nResolvelos antes de migrar: quedate con el id más chico, repuntá sus prices/positions, y borrá el resto.', dups;
  END IF;

  SELECT string_agg(format('%s / %s (ids: %s)', type, ticker, ids), E'\n  ')
    INTO dups
  FROM (
    SELECT type, ticker, string_agg(id::text, ',' ORDER BY id) AS ids
    FROM instruments
    WHERE ticker IS NOT NULL
    GROUP BY type, ticker
    HAVING COUNT(*) > 1
  ) d;

  IF dups IS NOT NULL THEN
    RAISE EXCEPTION E'Hay instrumentos duplicados por (type, ticker):\n  %', dups;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. CUSTODIOS
--
-- id = 0 es el centinela "sin custodio". Existe porque en Postgres NULL no
-- colisiona con NULL: un UNIQUE (user_id, custodian_id, instrument_id) con
-- custodian_id NULL permitiría filas duplicadas.
--
-- Los usuarios pueden crear custodios y quedan globales de inmediato. La lista
-- real es corta (~20 en Chile) y el autocomplete muestra los existentes primero,
-- así que el riesgo de tipeos es bajo. canonical_id permite fusionarlos después
-- sin borrar nada.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS custodians (
  id           SERIAL PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  country      TEXT NOT NULL DEFAULT 'CL',
  canonical_id INTEGER REFERENCES custodians(id),
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  meta         JSONB DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO custodians (id, slug, name, country) VALUES
  (0, 'sin-custodio', 'Sin custodio', 'CL')
ON CONFLICT (id) DO NOTHING;

INSERT INTO custodians (slug, name) VALUES
  ('fintual',   'Fintual'),
  ('racional',  'Racional'),
  ('vector',    'Vector Capital'),
  ('banchile',  'Banchile Inversiones'),
  ('bci',       'BCI Corredor de Bolsa'),
  ('santander', 'Santander Corredores'),
  ('buda',      'Buda.com'),
  ('ibkr',      'Interactive Brokers'),
  ('venturance','Venturance'),
  ('planvital', 'AFP PlanVital')
ON CONFLICT (slug) DO NOTHING;

-- El centinela ocupa el 0, pero la secuencia arranca en 1: no hay conflicto.
-- Igual la reseteamos por si el INSERT explícito la dejó atrás.
SELECT setval('custodians_id_seq', GREATEST((SELECT MAX(id) FROM custodians), 1));

-- ----------------------------------------------------------------------------
-- 2. MAESTRO DE ACTIVOS — gobierno y unicidad
--
-- status='pending_mapping' es el activo que trajo un usuario en su cartola y
-- todavía no tiene fuente de datos. Se trackea por monto, ya está en el maestro,
-- y cuando el admin le asigna una fuente el cron lo toma al día siguiente.
--
-- canonical_id apunta a la misma tabla: al detectar un duplicado se apunta al
-- canónico en vez de borrarlo, así no se pierde historial de precios.
-- ----------------------------------------------------------------------------
ALTER TABLE instruments
  ADD COLUMN IF NOT EXISTS status        TEXT    NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS fetch_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS canonical_id  INTEGER REFERENCES instruments(id),
  ADD COLUMN IF NOT EXISTS created_by    UUID    REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE instruments DROP CONSTRAINT IF EXISTS instruments_status_check;
ALTER TABLE instruments ADD CONSTRAINT instruments_status_check
  CHECK (status IN ('active','pending_mapping','deprecated'));

-- Los dos índices que impiden el maestro duplicado. Parciales porque muchos
-- instrumentos legítimamente no tienen ticker (fondos) ni external_id (manual).
CREATE UNIQUE INDEX IF NOT EXISTS uq_instruments_source
  ON instruments (api_source, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_instruments_ticker
  ON instruments (type, ticker) WHERE ticker IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_instruments_fetchable
  ON instruments (api_source) WHERE fetch_enabled AND status = 'active';

-- ----------------------------------------------------------------------------
-- 3. CARTOLAS
--
-- file_hash da idempotencia: resubir el mismo PDF no duplica nada.
-- raw_parse guarda la salida cruda del parser para poder reprocesar sin volver
-- a gastar una llamada al modelo.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS statements (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  custodian_id   INTEGER NOT NULL DEFAULT 0 REFERENCES custodians(id),
  file_hash      TEXT    NOT NULL,
  file_name      TEXT,
  statement_date DATE,
  status         TEXT    NOT NULL DEFAULT 'parsed'
                   CHECK (status IN ('parsed','confirmed','discarded')),
  raw_parse      JSONB,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at   TIMESTAMPTZ,
  UNIQUE (user_id, file_hash)
);

CREATE INDEX IF NOT EXISTS idx_statements_user ON statements (user_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 4. LEDGER — fuente de verdad
--
-- Append-only por convención: corregir un error es insertar un 'ajuste' o un
-- 'saldo' nuevo, no editar la fila vieja.
--
-- kind='saldo' guarda el valor ABSOLUTO de la posición a esa fecha, que es lo
-- que realmente dice una cartola. Los demás kinds son deltas.
--
-- instrument_id NULL = movimiento a nivel portafolio (el aporte mensual genérico
-- que hoy vive en movements). custodian_id 0 = sin custodio.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  custodian_id  INTEGER NOT NULL DEFAULT 0 REFERENCES custodians(id),
  instrument_id INTEGER REFERENCES instruments(id) ON DELETE CASCADE,
  statement_id  UUID    REFERENCES statements(id) ON DELETE SET NULL,
  date          DATE    NOT NULL,
  kind          TEXT    NOT NULL
                  CHECK (kind IN ('saldo','aporte','retiro','compra','venta','ajuste')),
  units         NUMERIC(20,8),
  price         NUMERIC(20,6),
  amount_clp    NUMERIC(20,2),
  amount_usd    NUMERIC(20,2),
  notes         TEXT,
  source        TEXT    NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('manual','cartola','chat','migracion')),
  external_ref  TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Un solo 'saldo' por activo, custodio y fecha: reprocesar una cartola
-- sobreescribe en vez de acumular. Los deltas NO llevan esta restricción,
-- porque sí querés poder registrar dos aportes el mismo día.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tx_saldo
  ON transactions (user_id, custodian_id, instrument_id, date)
  WHERE kind = 'saldo';

CREATE INDEX IF NOT EXISTS idx_tx_user_date
  ON transactions (user_id, date);
CREATE INDEX IF NOT EXISTS idx_tx_bucket
  ON transactions (user_id, custodian_id, instrument_id, date, id);
CREATE INDEX IF NOT EXISTS idx_tx_statement
  ON transactions (statement_id) WHERE statement_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 5. HISTORIA POR ACTIVO
--
-- Derivada: se puede truncar y reconstruir desde positions + prices.
-- Arranca vacía; los gráficos por activo empiezan desde la fecha de migración.
-- Sin particionar por ahora (ver decisión 6).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS position_snapshots (
  user_id       UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date          DATE    NOT NULL,
  custodian_id  INTEGER NOT NULL REFERENCES custodians(id),
  instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  units         NUMERIC(20,8),
  price_clp     NUMERIC(20,6),
  value_clp     NUMERIC(20,2),
  value_usd     NUMERIC(20,2),
  PRIMARY KEY (user_id, date, custodian_id, instrument_id)
);

CREATE INDEX IF NOT EXISTS idx_possnap_instrument
  ON position_snapshots (user_id, instrument_id, date);
CREATE INDEX IF NOT EXISTS idx_possnap_custodian
  ON position_snapshots (user_id, custodian_id, date);

-- ----------------------------------------------------------------------------
-- 6. POSICIONES — pasan a llevar custodio
-- ----------------------------------------------------------------------------
ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS custodian_id INTEGER NOT NULL DEFAULT 0 REFERENCES custodians(id);

-- El UNIQUE viejo era (user_id, instrument_id); el nombre lo generó Postgres,
-- así que lo buscamos en vez de asumirlo.
DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'positions'
    AND rel.relnamespace = 'public'::regnamespace
    AND con.contype = 'u'
    AND (SELECT array_agg(att.attname::text ORDER BY att.attname::text)
         FROM unnest(con.conkey) k
         JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k)
        = ARRAY['instrument_id','user_id']::text[]
  LIMIT 1;

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE positions DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE positions DROP CONSTRAINT IF EXISTS uq_positions_user_custodian_instrument;
ALTER TABLE positions ADD CONSTRAINT uq_positions_user_custodian_instrument
  UNIQUE (user_id, custodian_id, instrument_id);

-- ----------------------------------------------------------------------------
-- 7. RECONSTRUCCIÓN DE POSICIONES DESDE EL LEDGER
--
-- positions deja de ser escribible a mano. Toda escritura entra al ledger y
-- después llama a esta función.
--
-- Algoritmo: se busca el último 'saldo' de ese (usuario, custodio, activo);
-- eso fija la base. Después se aplican los deltas posteriores en orden
-- (date, id). Si no hay ningún saldo, la base es cero y se suman todos.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rebuild_position(
  p_user       UUID,
  p_custodian  INTEGER,
  p_instrument INTEGER
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date  DATE;
  v_id    BIGINT;
  v_units NUMERIC := NULL;
  v_clp   NUMERIC := NULL;
  v_usd   NUMERIC := NULL;
  v_n     INTEGER;
BEGIN
  -- Último saldo absoluto conocido.
  SELECT date, id, units, amount_clp, amount_usd
    INTO v_date, v_id, v_units, v_clp, v_usd
  FROM transactions
  WHERE user_id = p_user AND custodian_id = p_custodian
    AND instrument_id = p_instrument AND kind = 'saldo'
  ORDER BY date DESC, id DESC
  LIMIT 1;

  IF v_date IS NULL THEN
    v_date := '-infinity'::date;
    v_id   := -1;
  END IF;

  -- Deltas posteriores al saldo. 'ajuste' se suma con su propio signo.
  SELECT COALESCE(v_units, 0) + COALESCE(SUM(sign * COALESCE(units, 0)), 0),
         COALESCE(v_clp,   0) + COALESCE(SUM(sign * COALESCE(amount_clp, 0)), 0),
         COALESCE(v_usd,   0) + COALESCE(SUM(sign * COALESCE(amount_usd, 0)), 0)
    INTO v_units, v_clp, v_usd
  FROM (
    SELECT units, amount_clp, amount_usd,
           CASE WHEN kind IN ('retiro','venta') THEN -1 ELSE 1 END AS sign
    FROM transactions
    WHERE user_id = p_user AND custodian_id = p_custodian
      AND instrument_id = p_instrument
      AND kind <> 'saldo'
      AND (date, id) > (v_date, v_id)
  ) d;

  SELECT COUNT(*) INTO v_n
  FROM transactions
  WHERE user_id = p_user AND custodian_id = p_custodian
    AND instrument_id = p_instrument;

  -- Sin eventos, o todo en cero: la posición no existe más.
  IF v_n = 0 OR (COALESCE(v_units,0) = 0 AND COALESCE(v_clp,0) = 0 AND COALESCE(v_usd,0) = 0) THEN
    DELETE FROM positions
    WHERE user_id = p_user AND custodian_id = p_custodian AND instrument_id = p_instrument;
    RETURN;
  END IF;

  INSERT INTO positions (user_id, custodian_id, instrument_id, units, amount_clp, amount_usd, updated_at)
  VALUES (p_user, p_custodian, p_instrument,
          NULLIF(v_units, 0), NULLIF(v_clp, 0), NULLIF(v_usd, 0), NOW())
  ON CONFLICT (user_id, custodian_id, instrument_id)
  DO UPDATE SET units      = EXCLUDED.units,
                amount_clp = EXCLUDED.amount_clp,
                amount_usd = EXCLUDED.amount_usd,
                updated_at = NOW();
END $$;

-- Reconstruye todas las posiciones de un usuario. Idempotente.
CREATE OR REPLACE FUNCTION rebuild_positions_for_user(p_user UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  n INTEGER := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT custodian_id, instrument_id
    FROM transactions
    WHERE user_id = p_user AND instrument_id IS NOT NULL
  LOOP
    PERFORM rebuild_position(p_user, r.custodian_id, r.instrument_id);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- ----------------------------------------------------------------------------
-- 8. MIGRACIÓN DE DATOS
--
-- 8a. Los movements existentes pasan al ledger. Todos tienen instrument_id NULL
--     (routes/positions.js lo hardcodeaba), así que entran como movimientos a
--     nivel portafolio y computeTWR sigue funcionando igual.
--
-- 8b. Las positions actuales se convierten en un 'saldo' de hoy. Es el punto de
--     partida del ledger: sin esto, reconstruir positions daría cero.
-- ----------------------------------------------------------------------------
INSERT INTO transactions (user_id, custodian_id, instrument_id, date, kind,
                          amount_clp, amount_usd, notes, source, created_at)
SELECT m.user_id, 0, m.instrument_id, m.date, m.type,
       m.amount_clp, m.amount_usd, m.notes, 'migracion', m.created_at
FROM movements m
WHERE NOT EXISTS (SELECT 1 FROM transactions WHERE source = 'migracion')
  -- Si esto ya corrió, `movements` es la vista sobre transactions y copiar
  -- desde ahí duplicaría todo. El guard de arriba lo impide, pero dejamos el
  -- paso antes del rename del paso 9 justamente para leer la tabla real.
  AND EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.relname = 'movements'
      AND c.relnamespace = 'public'::regnamespace
      AND c.relkind = 'r'
  );

INSERT INTO transactions (user_id, custodian_id, instrument_id, date, kind,
                          units, amount_clp, amount_usd, notes, source)
SELECT p.user_id, p.custodian_id, p.instrument_id, CURRENT_DATE, 'saldo',
       p.units, p.amount_clp, p.amount_usd,
       'Saldo inicial al migrar al ledger', 'migracion'
FROM positions p
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- 9. movements → vista sobre transactions
--
-- La tabla se renombra (no se borra: es el respaldo de la migración) y en su
-- lugar queda una vista con el mismo nombre y las mismas columnas. Los 17
-- archivos que la leen no se tocan.
--
-- security_invoker = true es OBLIGATORIO. Sin eso la vista corre con los
-- permisos de su dueño y BYPASEA el RLS de transactions: cualquier usuario
-- autenticado podría leer los movimientos de todos.
--
-- La vista es auto-actualizable (un solo FROM, sin agregados, columnas simples),
-- así que los INSERT/UPDATE/DELETE que ya existen contra `movements` siguen
-- funcionando mientras se migra el código.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  -- Solo renombrar si `movements` sigue siendo tabla base y el destino está libre.
  -- En una segunda pasada `movements` ya es la vista: no hay nada que mover.
  IF EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.relname = 'movements'
      AND c.relnamespace = 'public'::regnamespace
      AND c.relkind = 'r'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.relname = 'movements_legacy'
      AND c.relnamespace = 'public'::regnamespace
  ) THEN
    EXECUTE 'ALTER TABLE movements RENAME TO movements_legacy';
  END IF;
END $$;

CREATE OR REPLACE VIEW movements
WITH (security_invoker = true) AS
SELECT id,
       user_id,
       instrument_id,
       date,
       kind AS type,
       amount_clp,
       amount_usd,
       notes,
       created_at
FROM transactions
WHERE kind IN ('aporte','retiro');

-- ----------------------------------------------------------------------------
-- 10. ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
ALTER TABLE custodians         ENABLE ROW LEVEL SECURITY;
ALTER TABLE statements         ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE position_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS custodians_read_all ON custodians;
CREATE POLICY custodians_read_all ON custodians
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS statements_all_own ON statements;
CREATE POLICY statements_all_own ON statements
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS transactions_all_own ON transactions;
CREATE POLICY transactions_all_own ON transactions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS possnap_all_own ON position_snapshots;
CREATE POLICY possnap_all_own ON position_snapshots
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Las funciones son SECURITY DEFINER (bypasean RLS a propósito, las llama el
-- backend con la service key). Nadie más las puede ejecutar.
REVOKE EXECUTE ON FUNCTION rebuild_position(UUID, INTEGER, INTEGER)  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION rebuild_positions_for_user(UUID)          FROM PUBLIC, anon, authenticated;

COMMIT;

-- ============================================================================
-- VERIFICACIÓN — correr después, fuera de la transacción
-- ============================================================================
-- Las posiciones reconstruidas desde el ledger tienen que dar igual que las
-- actuales. Si algo no cuadra, esta query lo muestra.
--
--   SELECT rebuild_positions_for_user(id) FROM users;
--
--   SELECT p.user_id, i.name, c.name AS custodio,
--          p.units, p.amount_clp, p.amount_usd
--   FROM positions p
--   JOIN instruments i ON i.id = p.instrument_id
--   JOIN custodians  c ON c.id = p.custodian_id
--   ORDER BY p.user_id, i.name;
--
-- Y el total del portafolio no tiene que haberse movido:
--
--   SELECT COUNT(*) AS movs_legacy FROM movements_legacy;
--   SELECT COUNT(*) AS movs_vista  FROM movements;
-- ============================================================================
