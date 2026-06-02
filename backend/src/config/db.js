// Pool de conexión a PostgreSQL (Supabase) + cliente Supabase con service role.
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// --- Pool Postgres directo (para queries del backend) ---
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase requiere SSL. rejectUnauthorized:false evita problemas de cadena en Render.
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('[db] Error inesperado en el pool de Postgres:', err.message);
});

// Helper para queries con logging opcional
export async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  if (process.env.LOG_QUERIES === 'true') {
    console.log('[db]', { text, ms: Date.now() - start, rows: res.rowCount });
  }
  return res;
}

// --- Cliente Supabase con SERVICE ROLE (bypassea RLS) ---
// Úsalo solo en el backend para escribir precios/snapshots globales y tareas admin.
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// --- Cliente Supabase con ANON key (para validar tokens de usuario) ---
export const supabaseAnon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
