-- ============================================================================
-- SIGNUP POR INVITACIÓN
--
-- Solo los correos que el admin haya invitado pueden registrarse. La validación
-- vive en la base, no en el frontend: el signup ocurre en el browser contra
-- Supabase con la anon key (que es pública), así que cualquier chequeo en React
-- sería trivial de saltar.
--
-- Se apoya en el hook "Before User Created" de Supabase, que corre dentro de la
-- transacción de signup y puede rechazarlo con un mensaje propio.
--
-- ORDEN DE EJECUCIÓN
--   1. Ejecutar este archivo completo en el SQL Editor de Supabase.
--   2. Dashboard → Authentication → Hooks → Before User Created →
--      elegir "Postgres function" → public.check_signup_invitation → Enable.
--   3. Dashboard → Authentication → Sign In / Providers → Email →
--      "Confirm email" → OFF.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. INVITACIONES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invitations (
  id         SERIAL PRIMARY KEY,
  email      VARCHAR(255) NOT NULL UNIQUE,   -- siempre en minúsculas
  note       TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  used_at    TIMESTAMPTZ                     -- se estampa al registrarse
);

CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations (email);

-- Sin políticas: solo el backend (service role) la toca. La función del hook
-- la lee con SECURITY DEFINER, así que no necesita permisos para anon.
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 2. HOOK: Before User Created
--
-- Devuelve '{}' para dejar pasar, o un objeto error para rechazar. El mensaje
-- llega tal cual al cliente, así que se escribe pensando en el usuario final.
--
-- Solo comprueba pertenencia, no consume la invitación: si marcáramos used_at
-- acá y el insert posterior fallara, la invitación quedaría quemada sin cuenta
-- creada. El duplicado de email ya lo impide Supabase por su lado.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_signup_invitation(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
BEGIN
  v_email := lower(trim(event->'user'->>'email'));

  IF v_email IS NULL OR v_email = '' THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'message',   'Correo inválido.',
      'http_code', 400
    ));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.invitations WHERE email = v_email) THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'message',   'Este correo no está invitado. Pedile una invitación al administrador.',
      'http_code', 403
    ));
  END IF;

  RETURN '{}'::jsonb;
END;
$$;

-- El hook lo ejecuta el rol de Auth, nadie más.
GRANT  EXECUTE ON FUNCTION public.check_signup_invitation TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.check_signup_invitation FROM authenticated, anon, public;

-- supabase_auth_admin necesita leer la tabla desde el hook.
GRANT USAGE  ON SCHEMA public      TO supabase_auth_admin;
GRANT SELECT ON TABLE invitations  TO supabase_auth_admin;

-- ----------------------------------------------------------------------------
-- 3. Marcar la invitación como usada cuando la cuenta ya existe de verdad.
--    Extiende el trigger que ya creaba la fila espejo en public.users.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'name', NEW.email))
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.invitations
     SET used_at = NOW()
   WHERE email = lower(NEW.email)
     AND used_at IS NULL;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- 4. BOOTSTRAP — EDITÁ EL EMAIL Y EJECUTÁ ESTA PARTE
--
-- El panel admin pasa a autenticarse con tu cuenta normal de Supabase + rol
-- 'admin', en vez del token hardcodeado. Sin esto quedás afuera del panel.
-- ----------------------------------------------------------------------------
UPDATE users SET role = 'admin' WHERE email = 'CAMBIA_ESTO@ejemplo.com';

-- Los usuarios que ya existen no pasan por el hook (solo aplica a registros
-- nuevos), pero los dejamos registrados como invitados para que el panel
-- muestre el estado real.
INSERT INTO invitations (email, note, used_at)
SELECT lower(email), 'Registrado antes de activar invitaciones', NOW()
FROM users
ON CONFLICT (email) DO NOTHING;
