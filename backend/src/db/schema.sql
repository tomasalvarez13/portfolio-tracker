-- ============================================================================
-- PORTFOLIO TRACKER - SCHEMA
-- PostgreSQL / Supabase
--
-- Multi-usuario. La autenticación la maneja Supabase Auth (auth.users).
-- La tabla `users` extiende auth.users con role (admin|user) y metadata.
--
-- Datos de mercado (instruments, prices, exchange_rates) son GLOBALES.
-- Datos del usuario (positions, movements, portfolio_snapshots) llevan user_id
-- y están protegidos con Row Level Security (RLS).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- USUARIOS (extiende auth.users de Supabase, mismo UUID)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      VARCHAR(255) NOT NULL UNIQUE,
  name       VARCHAR(100),
  role       VARCHAR(10)  NOT NULL DEFAULT 'user'
               CHECK (role IN ('admin', 'user')),
  created_at TIMESTAMPTZ  DEFAULT NOW()
);

-- Trigger: al crear un auth.user, crear la fila espejo en public.users
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'name', NEW.email))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ----------------------------------------------------------------------------
-- INSTRUMENTOS DE INVERSIÓN  (GLOBAL - compartido entre usuarios)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS instruments (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,           -- nombre oficial
  alias       VARCHAR(100),                    -- apodo opcional del usuario/UI
  type        VARCHAR(20)  NOT NULL
                CHECK (type IN ('stock_us','stock_cl','crypto','fondo_mutuo_cl','afp')),
  ticker      VARCHAR(50),                     -- AAPL, FALABELLA.SN, BTC...
  currency    VARCHAR(3)   NOT NULL CHECK (currency IN ('USD','CLP')),
  api_source  VARCHAR(30)  NOT NULL
                CHECK (api_source IN ('alpha_vantage','coingecko','cmf','sp','manual','yahoo_finance')),
  external_id VARCHAR(100),                    -- RUN/código del fondo en CMF, código SP, etc.
  meta        JSONB        DEFAULT '{}'::jsonb,-- extras: admin CMF, serie, etc.
  created_at  TIMESTAMPTZ  DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- TIPO DE CAMBIO USD/CLP  (dólar observado, GLOBAL)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exchange_rates (
  id         SERIAL PRIMARY KEY,
  date       DATE          NOT NULL UNIQUE,
  usd_clp    NUMERIC(12,4) NOT NULL,           -- CLP por 1 USD
  fetched_at TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_date ON exchange_rates (date DESC);

-- ----------------------------------------------------------------------------
-- PRECIOS HISTÓRICOS POR INSTRUMENTO  (GLOBAL)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prices (
  id            SERIAL PRIMARY KEY,
  instrument_id INTEGER      NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  date          DATE         NOT NULL,
  price_clp     NUMERIC(20,6),                 -- precio en CLP (nativo o convertido)
  price_usd     NUMERIC(20,6),                 -- precio en USD (nativo o convertido)
  source        VARCHAR(30),                   -- de dónde vino este precio
  is_stale      BOOLEAN      DEFAULT FALSE,     -- TRUE si es un carry-forward (no fresco)
  fetched_at    TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (instrument_id, date)
);

CREATE INDEX IF NOT EXISTS idx_prices_instrument_date ON prices (instrument_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_prices_date            ON prices (date DESC);

-- ----------------------------------------------------------------------------
-- POSICIONES ACTUALES  (POR USUARIO)
-- units y amount_* son mutuamente excluyentes por instrumento.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS positions (
  id            SERIAL PRIMARY KEY,
  user_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instrument_id INTEGER      NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  units         NUMERIC(20,8),                 -- cuotas/acciones (null si se usa amount)
  amount_clp    NUMERIC(20,2),                 -- monto directo CLP (null si se usa units)
  amount_usd    NUMERIC(20,2),                 -- monto directo USD (null si se usa units)
  notes         TEXT,
  updated_at    TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (user_id, instrument_id)              -- una posición por instrumento por usuario
);

CREATE INDEX IF NOT EXISTS idx_positions_user ON positions (user_id);

-- ----------------------------------------------------------------------------
-- MOVIMIENTOS (aportes y retiros)  (POR USUARIO)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS movements (
  id            SERIAL PRIMARY KEY,
  user_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- instrument_id es NULL para aportes/retiros a nivel de portafolio
  -- (sin instrumento específico, ej: historial de aportes mensuales).
  instrument_id INTEGER      REFERENCES instruments(id) ON DELETE CASCADE,
  date          DATE         NOT NULL,
  type          VARCHAR(10)  NOT NULL CHECK (type IN ('aporte','retiro')),
  amount_clp    NUMERIC(20,2),
  amount_usd    NUMERIC(20,2),
  notes         TEXT,
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_movements_user            ON movements (user_id);
CREATE INDEX IF NOT EXISTS idx_movements_user_date       ON movements (user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_movements_instrument      ON movements (instrument_id);

-- ----------------------------------------------------------------------------
-- SNAPSHOTS DIARIOS DEL PATRIMONIO TOTAL  (POR USUARIO)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id         SERIAL PRIMARY KEY,
  user_id    UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       DATE          NOT NULL,
  total_clp  NUMERIC(20,2) NOT NULL,
  total_usd  NUMERIC(20,2) NOT NULL,
  breakdown  JSONB         DEFAULT '{}'::jsonb,-- {type: {clp, usd}} para el detalle del día
  created_at TIMESTAMPTZ   DEFAULT NOW(),
  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_user_date ON portfolio_snapshots (user_id, date DESC);

-- ============================================================================
-- ROW LEVEL SECURITY
-- Cada usuario solo lee/escribe sus propias filas. Datos de mercado son
-- legibles por cualquier usuario autenticado y escritos solo por el service role
-- (el backend usa la service key, que bypassea RLS).
-- ============================================================================

ALTER TABLE users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE movements           ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE instruments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE prices              ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_rates      ENABLE ROW LEVEL SECURITY;

-- users: cada quien ve/edita su propia fila
DROP POLICY IF EXISTS users_select_own ON users;
CREATE POLICY users_select_own ON users
  FOR SELECT USING (auth.uid() = id);
DROP POLICY IF EXISTS users_update_own ON users;
CREATE POLICY users_update_own ON users
  FOR UPDATE USING (auth.uid() = id);

-- positions: dueño total sobre lo suyo
DROP POLICY IF EXISTS positions_all_own ON positions;
CREATE POLICY positions_all_own ON positions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- movements: dueño total sobre lo suyo
DROP POLICY IF EXISTS movements_all_own ON movements;
CREATE POLICY movements_all_own ON movements
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- portfolio_snapshots: dueño total sobre lo suyo
DROP POLICY IF EXISTS snapshots_all_own ON portfolio_snapshots;
CREATE POLICY snapshots_all_own ON portfolio_snapshots
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- instruments / prices / exchange_rates: lectura para cualquier usuario autenticado.
-- La escritura la hace el backend con la service role key (bypassea RLS).
DROP POLICY IF EXISTS instruments_read_all ON instruments;
CREATE POLICY instruments_read_all ON instruments
  FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS prices_read_all ON prices;
CREATE POLICY prices_read_all ON prices
  FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS exrates_read_all ON exchange_rates;
CREATE POLICY exrates_read_all ON exchange_rates
  FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================================
-- VISTA AUXILIAR: último precio disponible por instrumento
-- ============================================================================
CREATE OR REPLACE VIEW latest_prices AS
SELECT DISTINCT ON (p.instrument_id)
  p.instrument_id,
  p.date,
  p.price_clp,
  p.price_usd,
  p.is_stale,
  p.source,
  p.fetched_at
FROM prices p
ORDER BY p.instrument_id, p.date DESC;
