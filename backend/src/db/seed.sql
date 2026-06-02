-- ============================================================================
-- PORTFOLIO TRACKER - SEED
--
-- 1) Inserta los INSTRUMENTOS (global, idempotente).
-- 2) Inserta las POSICIONES del usuario indicado por email (editar abajo).
--
-- Ejecutar DESPUÉS de schema.sql y DESPUÉS de haber registrado tu usuario
-- en la app (para que exista la fila en public.users).
--
-- Valores validados contra certificados reales al 30-31/may/2026:
--   - 9 acciones/ETFs USA (Alpha Vantage) ............ calce 100%
--   - Bitcoin (CoinGecko)
--   - 4 fondos Fintual (CMF, admin 76810627) ......... calce -0.001%
--   - 2 fondos Venturance (FIP, manual) .............. sin API pública
--   - APV PlanVital Fondo A (Superintendencia Pensiones)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. INSTRUMENTOS (GLOBAL)
-- ----------------------------------------------------------------------------
INSERT INTO instruments (name, alias, type, ticker, currency, api_source, external_id, meta) VALUES
  -- Acciones / ETFs USA (Alpha Vantage) ---------------------------------------
  ('Amazon.com Inc',                    NULL, 'stock_us', 'AMZN',  'USD', 'alpha_vantage', 'AMZN',  '{}'),
  ('Global X Copper Miners ETF',        NULL, 'stock_us', 'COPX',  'USD', 'alpha_vantage', 'COPX',  '{}'),
  ('iShares MSCI Chile ETF',            NULL, 'stock_us', 'ECH',   'USD', 'alpha_vantage', 'ECH',   '{}'),
  ('Alphabet Inc (Google)',             NULL, 'stock_us', 'GOOGL', 'USD', 'alpha_vantage', 'GOOGL', '{}'),
  ('iShares Latin America 40 ETF',      NULL, 'stock_us', 'ILF',   'USD', 'alpha_vantage', 'ILF',   '{}'),
  ('Microsoft Corp',                    NULL, 'stock_us', 'MSFT',  'USD', 'alpha_vantage', 'MSFT',  '{}'),
  ('SPDR S&P 500 ETF',                  NULL, 'stock_us', 'SPY',   'USD', 'alpha_vantage', 'SPY',   '{}'),
  ('Sociedad Quimica y Minera (SQM)',   NULL, 'stock_us', 'SQM',   'USD', 'alpha_vantage', 'SQM',   '{}'),
  ('Tesla Inc',                         NULL, 'stock_us', 'TSLA',  'USD', 'alpha_vantage', 'TSLA',  '{}'),

  -- Crypto (CoinGecko) --------------------------------------------------------
  ('Bitcoin',                           NULL, 'crypto',   'BTC',   'USD', 'coingecko',     'bitcoin', '{}'),

  -- Fondos Mutuos Fintual (CMF, administradora 76810627, serie A) -------------
  ('FM Fintual Risky Norris',           NULL, 'fondo_mutuo_cl', NULL, 'CLP', 'cmf', '9570', '{"admin":"76810627","serie":"A"}'),
  ('FM Fintual Moderate Pitt',          NULL, 'fondo_mutuo_cl', NULL, 'CLP', 'cmf', '9569', '{"admin":"76810627","serie":"A"}'),
  ('FM Fintual Conservative Clooney',   NULL, 'fondo_mutuo_cl', NULL, 'CLP', 'cmf', '9568', '{"admin":"76810627","serie":"A"}'),
  ('FM Fintual Very Conservative Streep', NULL, 'fondo_mutuo_cl', NULL, 'CLP', 'cmf', '9730', '{"admin":"76810627","serie":"A"}'),

  -- Fondos de Inversión Venturance (FIP, sin API pública -> manual) -----------
  ('FI Tronador Capital Preferente',    NULL, 'fondo_mutuo_cl', NULL, 'CLP', 'manual', NULL, '{"serie":"A","admin_name":"Venturance"}'),
  ('FIP Sierra Nevada',                 NULL, 'fondo_mutuo_cl', NULL, 'CLP', 'manual', NULL, '{"serie":"B2","admin_name":"Venturance"}'),

  -- APV (Superintendencia de Pensiones, PlanVital Fondo A) --------------------
  ('APV PlanVital Fondo A',             NULL, 'afp', NULL, 'CLP', 'sp', 'PLANVITAL', '{"tipo_fondo":"A","afp":"PLANVITAL"}')
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. POSICIONES del usuario (EDITA el email en la línea seed_email)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  seed_email TEXT := 'CAMBIA_ESTO@ejemplo.com';   -- <<< pon aquí el email con que te registraste
  uid UUID;
BEGIN
  SELECT id INTO uid FROM users WHERE email = seed_email;
  IF uid IS NULL THEN
    RAISE NOTICE 'No existe usuario con email %, registra primero en la app. Posiciones NO insertadas.', seed_email;
    RETURN;
  END IF;

  -- Posiciones por unidades (units). amount_* quedan NULL.
  -- Insert idempotente: upsert por (user_id, instrument_id).
  INSERT INTO positions (user_id, instrument_id, units)
  SELECT uid, i.id, v.units
  FROM (VALUES
    ('AMZN',  2.764607283),
    ('COPX',  4.750988142),
    ('ECH',   5.475251861),
    ('GOOGL', 1.783198720),
    ('ILF',   3.677169707),
    ('MSFT',  1.062406583),
    ('SPY',   0.947933669),
    ('SQM',   2.596537416),
    ('TSLA',  1.788025500),
    ('BTC',   0.007376730)
  ) AS v(ticker, units)
  JOIN instruments i ON i.ticker = v.ticker
  ON CONFLICT (user_id, instrument_id) DO UPDATE SET units = EXCLUDED.units, updated_at = NOW();

  -- Fondos CLP por cuotas (units), match por nombre
  INSERT INTO positions (user_id, instrument_id, units)
  SELECT uid, i.id, v.units
  FROM (VALUES
    ('FM Fintual Risky Norris',             866.5497),
    ('FM Fintual Moderate Pitt',            728.3994),
    ('FM Fintual Conservative Clooney',    2094.5231),
    ('FM Fintual Very Conservative Streep',2707.1533),
    ('FI Tronador Capital Preferente',  1239014.0000),  -- valor cuota = 1
    ('FIP Sierra Nevada',                  4115.0000),  -- valor cuota = 1114.5256
    ('APV PlanVital Fondo A',                 9.7100)   -- recalculado: 870190 / 89617.87
  ) AS v(name, units)
  JOIN instruments i ON i.name = v.name
  ON CONFLICT (user_id, instrument_id) DO UPDATE SET units = EXCLUDED.units, updated_at = NOW();

  RAISE NOTICE 'Posiciones insertadas para usuario % (uid %)', seed_email, uid;
END $$;

-- ----------------------------------------------------------------------------
-- 3. PRECIOS MANUALES iniciales para los FIP Venturance (sin API)
--    Valores cuota al 30/05/2026 según cartola. Se cargan como precio del día.
--    El resto de precios los traerá el cron job al ejecutarse.
-- ----------------------------------------------------------------------------
INSERT INTO prices (instrument_id, date, price_clp, source, is_stale)
SELECT i.id, DATE '2026-05-30', v.price_clp, 'manual', FALSE
FROM (VALUES
  ('FI Tronador Capital Preferente',    1.0000),
  ('FIP Sierra Nevada',              1114.5256)
) AS v(name, price_clp)
JOIN instruments i ON i.name = v.name
ON CONFLICT (instrument_id, date) DO UPDATE SET price_clp = EXCLUDED.price_clp;
