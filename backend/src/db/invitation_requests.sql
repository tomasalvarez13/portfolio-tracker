-- ============================================================================
-- SOLICITUDES DE INVITACIÓN
--
-- Quien intenta registrarse sin invitación puede dejar su correo pedido. Las
-- solicitudes llegan al panel admin, y aprobarlas crea la invitación.
--
-- Ejecutar en el SQL Editor de Supabase después de invitations.sql.
-- ============================================================================

CREATE TABLE IF NOT EXISTS invitation_requests (
  id          SERIAL PRIMARY KEY,
  email       VARCHAR(255) NOT NULL UNIQUE,     -- siempre en minúsculas
  name        VARCHAR(100),
  message     TEXT,
  status      VARCHAR(10) NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_invitation_requests_status
  ON invitation_requests (status, created_at DESC);

-- Solo el backend (service role) la toca. El alta entra por POST /api/invite-requests,
-- que es público pero pasa por validación y límite por IP.
ALTER TABLE invitation_requests ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- Red de seguridad a nivel Postgres para el signup por invitación.
--
-- Va acá porque se aplicó a mano en el SQL Editor y el repo no lo reflejaba.
-- Es idempotente: si ya lo corriste, esto no cambia nada.
--
-- El hook "Before User Created" da el mensaje lindo; este trigger garantiza que
-- la restricción se cumpla aunque el hook quede desactivado por error.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_invitation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.invitations WHERE email = lower(trim(NEW.email)))
  THEN
    RAISE EXCEPTION 'signup_not_invited: % no tiene invitación', NEW.email
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_invitation_before_insert ON auth.users;
CREATE TRIGGER enforce_invitation_before_insert
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_invitation();
