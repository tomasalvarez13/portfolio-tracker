// Cliente Supabase del frontend (solo anon key, nunca service role).
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn('[supabase] Falta VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en .env');
}

// createClient lanza si la URL viene vacía, y al ser un import de nivel superior eso
// dejaba la app entera en blanco. Con placeholders el login falla de forma visible
// (y el modo demo, que no toca Supabase, sigue funcionando).
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  anonKey || 'placeholder-anon-key',
  { auth: { persistSession: true, autoRefreshToken: true } }
);
