-- ============================================================================
-- FASE 2 (§3.1) — cartolas persistidas y matching por trigramas
--
-- Dos problemas del flujo actual:
--
-- 1. El prompt de parse-cartola manda el maestro COMPLETO a Gemini para que
--    haga el matching. Con 17 instrumentos anda; con 2.000 el costo por cartola
--    crece sin techo y el matching empeora. Acá el matching sale del prompt y
--    pasa a SQL con pg_trgm: la extracción solo lee el documento, y el maestro
--    nunca entra al prompt.
--
-- 2. Nada queda registrado. Subir la misma cartola dos veces reescribía las
--    posiciones sin dejar rastro del documento ni del valor anterior.
--    `statements` ya existe desde la migración 002 pero no se usaba.
--
-- EJECUCIÓN: correr completo en el SQL Editor de Supabase. Idempotente.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. TRIGRAMAS
--
-- pg_trgm permite similitud por subcadenas de 3 caracteres, que es lo que hace
-- falta acá: la cartola dice "RISKY NORRIS SERIE A" y el maestro tiene
-- "FM Fintual Risky Norris". No hay igualdad ni prefijo común, pero comparten
-- casi todos los trigramas.
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ----------------------------------------------------------------------------
-- 2. TEXTO NORMALIZADO PARA BUSCAR
--
-- Columna generada, para que el índice GIN se mantenga solo. Concatena nombre,
-- alias y ticker: la cartola a veces trae el ticker y a veces el nombre largo.
--
-- unaccent no se usa a propósito: es otra extensión más, y los nombres de
-- fondos chilenos casi no llevan tildes. lower() alcanza.
-- ----------------------------------------------------------------------------
ALTER TABLE instruments
  ADD COLUMN IF NOT EXISTS search_text TEXT
    GENERATED ALWAYS AS (
      lower(coalesce(name, '') || ' ' || coalesce(alias, '') || ' ' || coalesce(ticker, ''))
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_instruments_search_trgm
  ON instruments USING GIN (search_text gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- 3. CANDIDATOS PARA UNA FILA DE CARTOLA
--
-- Devuelve los mejores matches del maestro para un texto suelto. `p_user`
-- incluye los activos pending_mapping que creó ese usuario (invisibles para los
-- demás) además de los globales activos.
--
-- Dos detalles que importan:
--
-- a) El score combina similarity() y word_similarity(). similarity() divide por
--    el total de trigramas de AMBAS cadenas, así que castiga la diferencia de
--    largo: "SQM-B" contra "Sociedad Quimica y Minera (SQM)" da 0.129 y queda
--    fuera de cualquier umbral razonable. word_similarity() compara la query
--    contra el mejor tramo de palabras del target y da 0.667 en ese mismo caso;
--    para "AMZN" pasa de 0.278 a 1.000. Las cartolas mezclan tickers cortos con
--    nombres largos, así que hacen falta las dos y se toma la mayor.
--
-- b) El WHERE usa los operadores % y <%, no las funciones. `similarity(a,b) > x`
--    obliga a calcular el score de todas las filas: seq scan garantizado. Los
--    operadores sí consultan el índice GIN. Los umbrales se pasan por GUC en el
--    SET de abajo, que es de donde los leen.
--
-- Los umbrales son bajos a propósito: mejor ofrecer un candidato flojo que el
-- usuario descarta, que no ofrecer nada y obligarlo a buscar en una lista de
-- cientos. La UI muestra el score para que se vea cuál es dudoso.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION match_instruments(
  p_text  TEXT,
  p_user  UUID    DEFAULT NULL,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  id         INTEGER,
  name       TEXT,
  alias      TEXT,
  ticker     TEXT,
  type       TEXT,
  currency   TEXT,
  status     TEXT,
  similarity REAL
)
LANGUAGE sql
STABLE
SET search_path = public
SET pg_trgm.similarity_threshold = 0.15
SET pg_trgm.word_similarity_threshold = 0.45
AS $$
  SELECT i.id, i.name::text, i.alias::text, i.ticker::text, i.type::text,
         i.currency::text, i.status::text,
         GREATEST(similarity(i.search_text, lower(p_text)),
                  word_similarity(lower(p_text), i.search_text)) AS similarity
  FROM instruments i
  WHERE i.canonical_id IS NULL
    AND (
      i.status = 'active'
      OR (i.status = 'pending_mapping' AND p_user IS NOT NULL AND i.created_by = p_user)
    )
    -- Operadores, no funciones: son los que usan el índice GIN.
    AND (i.search_text % lower(p_text) OR lower(p_text) <% i.search_text)
  ORDER BY similarity DESC, i.name
  LIMIT p_limit;
$$;

-- ----------------------------------------------------------------------------
-- 4. VISIBILIDAD DE LOS ACTIVOS pending_mapping
--
-- La política de la 002 dejaba `instruments` legible para cualquier autenticado.
-- Ahora que los usuarios pueden crear activos desde la cartola, un "Fondo XYZ"
-- mal escrito por alguien no tiene que aparecerle a todos: solo los activos
-- activos son globales, y los pending_mapping los ve su creador.
--
-- El backend usa la service role key y bypasea RLS, así que esto solo aplica si
-- alguna vez se consulta la tabla directo desde el cliente.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS instruments_read_all     ON instruments;
DROP POLICY IF EXISTS instruments_read_visible ON instruments;
CREATE POLICY instruments_read_visible ON instruments
  FOR SELECT USING (
    auth.role() = 'authenticated'
    AND (status <> 'pending_mapping' OR created_by = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- 5. `statements` — lo que faltaba para usarla
--
-- La 002 creó la tabla. Le agregamos el conteo de filas propuestas, para poder
-- mostrar el historial de cartolas sin releer el JSON completo.
-- ----------------------------------------------------------------------------
ALTER TABLE statements
  ADD COLUMN IF NOT EXISTS rows_proposed INTEGER,
  ADD COLUMN IF NOT EXISTS rows_confirmed INTEGER;

-- ----------------------------------------------------------------------------
-- 6. PRECISIÓN DE position_snapshots
--
-- La 002 dejó value_clp y value_usd en NUMERIC(20,2). Con portfolio_snapshots
-- calculado como agregación del detalle (§3.3), el total pasa a ser la suma de
-- valores YA redondeados por fila, mientras el Resumen los calcula en vivo sin
-- redondear: sum(round(x)) ≠ round(sum(x)). Con 5 posiciones la diferencia en
-- USD ya era de un centavo.
--
-- El valor por activo es un número interno, no un monto a mostrar, así que no
-- gana nada con estar a 2 decimales. A 6 la diferencia baja a ruido.
--
-- Es un rewrite de tabla, y por eso conviene ahora: position_snapshots recién
-- empezó a poblarse. Hacerlo en un año, con millones de filas, es caro.
-- ----------------------------------------------------------------------------
ALTER TABLE position_snapshots
  ALTER COLUMN value_clp TYPE NUMERIC(20,6),
  ALTER COLUMN value_usd TYPE NUMERIC(20,6);

-- ----------------------------------------------------------------------------
-- 6. FUSIONAR DOS ACTIVOS
--
-- Hace falta para que la cola admin de pending_mapping sea accionable. Si un
-- usuario crea "Fondo XYZ" desde su cartola y en el maestro ya estaba
-- "FM Fondo XYZ", marcarlo como activo crearía un duplicado global. La salida
-- correcta es fusionarlo.
--
-- `positions` es derivada, así que no se repunta: se repunta el LEDGER y se
-- reconstruye. Eso resuelve solo el caso en que el usuario ya tenía posiciones
-- en los dos activos, que si se repuntara la caché directo colisionaría con la
-- clave única.
--
-- `position_snapshots` sí se repunta, sumando cuando colisiona: si un usuario
-- tenía las dos filas el mismo día, son el mismo activo real y el valor total
-- es la suma. Si se borraran, el detalle por activo dejaría de cuadrar con los
-- portfolio_snapshots históricos, que no se regeneran.
--
-- El origen no se borra: queda con canonical_id apuntando al destino, así el
-- historial de precios sigue existiendo y el maestro no pierde trazabilidad.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION merge_instruments(p_source INTEGER, p_target INTEGER)
RETURNS TABLE (transacciones INTEGER, saldos_sumados INTEGER, snapshots INTEGER, usuarios INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  n_tx     INTEGER := 0;   -- repuntadas
  n_merged INTEGER := 0;   -- saldos que se sumaron al del destino
  n_snap   INTEGER := 0;
  n_users  INTEGER := 0;
  r RECORD;
BEGIN
  IF p_source = p_target THEN
    RAISE EXCEPTION 'No se puede fusionar un activo consigo mismo';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM instruments WHERE id = p_target AND canonical_id IS NULL) THEN
    RAISE EXCEPTION 'El activo destino % no existe o ya está fusionado', p_target;
  END IF;

  -- Los usuarios afectados, antes de mover nada.
  CREATE TEMP TABLE IF NOT EXISTS _merge_users (user_id UUID, custodian_id INTEGER) ON COMMIT DROP;
  DELETE FROM _merge_users;
  INSERT INTO _merge_users
  SELECT DISTINCT user_id, custodian_id FROM transactions WHERE instrument_id IN (p_source, p_target);

  -- 1a. Saldos que van a colisionar.
  --
  -- uq_tx_saldo es único por (usuario, custodio, activo, fecha) para kind='saldo',
  -- así que repuntar de una revienta cuando el usuario tiene un saldo en los dos
  -- activos el mismo día — que es EL caso común, porque el duplicado normalmente
  -- vino de la misma cartola.
  --
  -- Son el mismo activo real, así que el saldo correcto es la suma. El CASE
  -- preserva NULL cuando ambos son NULL: una posición por monto no tiene units,
  -- y convertirla en 0 cambiaría cómo la lee rebuild_position().
  UPDATE transactions t
     SET units      = CASE WHEN t.units      IS NULL AND src.units      IS NULL THEN NULL
                           ELSE COALESCE(t.units, 0)      + COALESCE(src.units, 0)      END,
         amount_clp = CASE WHEN t.amount_clp IS NULL AND src.amount_clp IS NULL THEN NULL
                           ELSE COALESCE(t.amount_clp, 0) + COALESCE(src.amount_clp, 0) END,
         amount_usd = CASE WHEN t.amount_usd IS NULL AND src.amount_usd IS NULL THEN NULL
                           ELSE COALESCE(t.amount_usd, 0) + COALESCE(src.amount_usd, 0) END
    FROM (
      SELECT user_id, custodian_id, date,
             SUM(units) AS units, SUM(amount_clp) AS amount_clp, SUM(amount_usd) AS amount_usd
      FROM transactions
      WHERE instrument_id = p_source AND kind = 'saldo'
      GROUP BY user_id, custodian_id, date
    ) src
   WHERE t.instrument_id = p_target AND t.kind = 'saldo'
     AND t.user_id = src.user_id AND t.custodian_id = src.custodian_id AND t.date = src.date;
  GET DIAGNOSTICS n_merged = ROW_COUNT;

  -- 1b. Borrar del origen los saldos que ya se sumaron al destino.
  DELETE FROM transactions s
   WHERE s.instrument_id = p_source AND s.kind = 'saldo'
     AND EXISTS (
       SELECT 1 FROM transactions t
       WHERE t.instrument_id = p_target AND t.kind = 'saldo'
         AND t.user_id = s.user_id AND t.custodian_id = s.custodian_id AND t.date = s.date
     );

  -- 1c. El resto se repunta. Los deltas (aporte, retiro, compra…) no tienen
  --     restricción de unicidad, así que pasan sin conflicto.
  UPDATE transactions SET instrument_id = p_target WHERE instrument_id = p_source;
  GET DIAGNOSTICS n_tx = ROW_COUNT;
  -- El total que se movió incluye los saldos sumados: si solo se contaran las
  -- repuntadas, una fusión donde todos los saldos colisionan reportaría 0.
  n_tx := n_tx + n_merged;

  -- 2. Historia por activo, sumando las colisiones.
  INSERT INTO position_snapshots
    (user_id, date, custodian_id, instrument_id, units, price_clp, value_clp, value_usd)
  SELECT user_id, date, custodian_id, p_target, units, price_clp, value_clp, value_usd
  FROM position_snapshots WHERE instrument_id = p_source
  ON CONFLICT (user_id, date, custodian_id, instrument_id) DO UPDATE
    SET units     = COALESCE(position_snapshots.units, 0)     + COALESCE(EXCLUDED.units, 0),
        value_clp = COALESCE(position_snapshots.value_clp, 0) + COALESCE(EXCLUDED.value_clp, 0),
        value_usd = COALESCE(position_snapshots.value_usd, 0) + COALESCE(EXCLUDED.value_usd, 0);
  GET DIAGNOSTICS n_snap = ROW_COUNT;
  DELETE FROM position_snapshots WHERE instrument_id = p_source;

  -- 3. La caché de posiciones se rehace desde el ledger.
  DELETE FROM positions WHERE instrument_id = p_source;
  FOR r IN SELECT DISTINCT user_id, custodian_id FROM _merge_users LOOP
    PERFORM rebuild_position(r.user_id, r.custodian_id, p_target);
    n_users := n_users + 1;
  END LOOP;

  -- 4. El origen queda apuntando al destino, no se borra.
  UPDATE instruments
     SET canonical_id = p_target, status = 'deprecated', fetch_enabled = FALSE
   WHERE id = p_source;

  RETURN QUERY SELECT n_tx, n_merged, n_snap, n_users;
END $fn$;

REVOKE EXECUTE ON FUNCTION merge_instruments(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;

COMMIT;

-- ============================================================================
-- VERIFICACIÓN
-- ============================================================================
--   SELECT * FROM match_instruments('RISKY NORRIS SERIE A');
--   SELECT * FROM match_instruments('Amazon');
--   SELECT * FROM match_instruments('Fondo que no existe');   -- 0 filas
--
-- Y que el índice se use (con volumen suficiente):
--   EXPLAIN SELECT * FROM match_instruments('risky norris');
-- ============================================================================
