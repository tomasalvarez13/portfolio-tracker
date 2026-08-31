-- ============================================================================
-- FASE 2a (§3.2) — cola de precios y calendario de mercado
--
-- El cron actual es un `for` secuencial con sleep(1000) por acción, dentro de
-- UNA request HTTP. GitHub Actions la llama con --max-time 120. Con 17
-- instrumentos son ~20 s; con 200 el curl corta; con 1.000 Render mata el
-- proceso. Y no hay estado por instrumento: si un fondo falla se hace
-- carry-forward y listo, sin reintentos ni forma de saber que lleva días roto.
--
-- Acá el trabajo pasa a ser una cola: un tick encola y un worker procesa lotes
-- chicos que responden en segundos. El tiempo total deja de vivir dentro de un
-- timeout.
--
-- EJECUCIÓN: correr completo en el SQL Editor de Supabase. Idempotente.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. COLA DE FETCHES
--
-- Una fila por (instrumento, fecha). El worker toma lotes con FOR UPDATE SKIP
-- LOCKED, así varios workers en paralelo no se pisan y un worker que muere no
-- bloquea la fila para siempre.
--
-- Estados:
--   pending  esperando que la tome un worker
--   running  tomada; locked_at permite recuperar las que quedaron colgadas
--   done     precio fresco guardado
--   no_data  la fuente respondió pero no tiene dato para ese día. NO es un
--            error: pasa en feriados y con el rezago de los fondos. Se separa
--            de `failed` para no disparar alarmas por algo normal.
--   failed   agotó los reintentos. Esto sí es para mirar.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS price_fetch_jobs (
  id            BIGSERIAL PRIMARY KEY,
  instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  date          DATE    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','running','done','no_data','failed')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  next_retry_at TIMESTAMPTZ,
  locked_at     TIMESTAMPTZ,
  source_used   TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (instrument_id, date)
);

-- El índice que usa el claim del worker: solo las que puede tomar.
CREATE INDEX IF NOT EXISTS idx_jobs_claimable
  ON price_fetch_jobs (next_retry_at NULLS FIRST, id)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_jobs_date_status
  ON price_fetch_jobs (date, status);

ALTER TABLE price_fetch_jobs ENABLE ROW LEVEL SECURITY;
-- Sin políticas: es infraestructura, solo la toca el backend con la service key.

-- ----------------------------------------------------------------------------
-- 2. FERIADOS DE MERCADO
--
-- Sirve para no encolar trabajo que no puede existir. Sin esto, un feriado se
-- ve igual que una fuente caída: el job reintenta, agota los intentos y termina
-- en `failed`, ensuciando cualquier alerta.
--
-- Se siembra solo con los feriados chilenos de fecha fija, que son los únicos
-- que se pueden afirmar sin calcular. Los móviles (Viernes Santo, los que se
-- corren al lunes) y los feriados de EE.UU. quedan para cargar a mano o desde
-- el panel: es preferible una tabla incompleta y honesta a uno inventado.
--
-- Un feriado que falta no rompe nada: el job va a dar no_data y se hace
-- carry-forward, que es exactamente lo que corresponde ese día.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_holidays (
  market TEXT NOT NULL CHECK (market IN ('CL','US','CRYPTO')),
  date   DATE NOT NULL,
  name   TEXT,
  PRIMARY KEY (market, date)
);

ALTER TABLE market_holidays ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS holidays_read_all ON market_holidays;
CREATE POLICY holidays_read_all ON market_holidays
  FOR SELECT USING (auth.role() = 'authenticated');

-- Feriados chilenos de fecha fija, 2026 y 2027. Los móviles no van.
INSERT INTO market_holidays (market, date, name) VALUES
  ('CL','2026-01-01','Año Nuevo'),
  ('CL','2026-05-01','Día del Trabajo'),
  ('CL','2026-05-21','Glorias Navales'),
  ('CL','2026-06-29','San Pedro y San Pablo'),
  ('CL','2026-07-16','Virgen del Carmen'),
  ('CL','2026-08-15','Asunción de la Virgen'),
  ('CL','2026-09-18','Independencia Nacional'),
  ('CL','2026-09-19','Glorias del Ejército'),
  ('CL','2026-10-12','Encuentro de Dos Mundos'),
  ('CL','2026-10-31','Iglesias Evangélicas'),
  ('CL','2026-11-01','Día de Todos los Santos'),
  ('CL','2026-12-08','Inmaculada Concepción'),
  ('CL','2026-12-25','Navidad'),
  ('CL','2027-01-01','Año Nuevo'),
  ('CL','2027-05-01','Día del Trabajo'),
  ('CL','2027-05-21','Glorias Navales'),
  ('CL','2027-06-29','San Pedro y San Pablo'),
  ('CL','2027-07-16','Virgen del Carmen'),
  ('CL','2027-08-15','Asunción de la Virgen'),
  ('CL','2027-09-18','Independencia Nacional'),
  ('CL','2027-09-19','Glorias del Ejército'),
  ('CL','2027-10-12','Encuentro de Dos Mundos'),
  ('CL','2027-10-31','Iglesias Evangélicas'),
  ('CL','2027-11-01','Día de Todos los Santos'),
  ('CL','2027-12-08','Inmaculada Concepción'),
  ('CL','2027-12-25','Navidad'),
  ('US','2026-01-01','New Year''s Day'),
  ('US','2026-07-03','Independence Day (observado)'),
  ('US','2026-12-25','Christmas'),
  ('US','2027-01-01','New Year''s Day'),
  ('US','2027-07-05','Independence Day (observado)'),
  ('US','2027-12-24','Christmas (observado)')
ON CONFLICT (market, date) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. HUECOS DE PRECIO POR INSTRUMENTO
--
-- Cuando una fuente vuelve después de estar caída, el cron viejo pedía solo
-- hoy: los días que faltaron quedaban is_stale para siempre. Esto los lista
-- para poder pedir el rango en vez del punto.
--
-- Solo mira días hábiles y descuenta el rezago esperado, así un fondo que
-- publica con dos días de atraso no aparece como si tuviera huecos.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION price_gaps(
  p_instrument INTEGER,
  p_market     TEXT,
  p_since      DATE,
  p_until      DATE
)
RETURNS TABLE (date DATE)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT d::date
  FROM generate_series(p_since, p_until, '1 day') d
  WHERE EXTRACT(ISODOW FROM d) < 6                    -- lunes a viernes
    AND NOT EXISTS (SELECT 1 FROM market_holidays h
                    WHERE h.market = p_market AND h.date = d::date)
    AND NOT EXISTS (SELECT 1 FROM prices p
                    WHERE p.instrument_id = p_instrument
                      AND p.date = d::date
                      AND p.is_stale = FALSE)
  ORDER BY d;
$$;

-- ----------------------------------------------------------------------------
-- 4. MARCAR LOS SNAPSHOTS CON PRECIO NO FRESCO
--
-- El plan decía "excluir los tramos is_stale del cálculo de rentabilidad". Está
-- mal: un carry-forward no borra rentabilidad, la corre de día — el retorno
-- aparece cuando el precio real vuelve. Sacar esos tramos del TWR le quitaría
-- retorno que sí existió, y el producto geométrico sobre el período completo da
-- lo mismo con o sin ellos.
--
-- El problema real no es el total, es la granularidad: un money market plano
-- cinco días y después saltando muestra un pico artificial en la variación
-- diaria y en el mes. La respuesta correcta es que el número se pueda marcar,
-- no que se descarte.
-- ----------------------------------------------------------------------------
ALTER TABLE position_snapshots
  ADD COLUMN IF NOT EXISTS is_stale BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE portfolio_snapshots
  ADD COLUMN IF NOT EXISTS stale_positions INTEGER NOT NULL DEFAULT 0;

COMMIT;

-- ============================================================================
-- VERIFICACIÓN
-- ============================================================================
--   SELECT status, count(*) FROM price_fetch_jobs GROUP BY status;
--   SELECT * FROM price_gaps(1, 'US', CURRENT_DATE - 30, CURRENT_DATE);
--
-- Jobs colgados (worker que murió a mitad):
--   SELECT * FROM price_fetch_jobs
--   WHERE status = 'running' AND locked_at < NOW() - INTERVAL '10 minutes';
-- ============================================================================
