// Pool de conexión a PostgreSQL (Supabase) + cliente Supabase con service role.
import dns from 'dns/promises';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

/**
 * Resuelve el hostname de DATABASE_URL a IPv4 y devuelve la URL modificada.
 * Render free tier no tiene IPv6, así que si Supabase devuelve una dirección
 * IPv6 el pool no puede conectarse. Al resolver a IPv4 antes de crear el pool
 * forzamos una conexión que funciona.
 */
async function resolveIPv4ConnectionString(connStr) {
  if (!connStr || connStr.includes('localhost') || connStr.includes('127.0.0.1')) {
    return connStr;
  }
  try {
    const url = new URL(connStr);
    const hostname = url.hostname;
    // Resolver solo IPv4 (family: 4)
    const { address } = await dns.lookup(hostname, { family: 4 });
    url.hostname = address;
    console.log(`[db] DNS resuelto: ${hostname} → ${address} (IPv4)`);
    return url.toString();
  } catch (e) {
    console.warn('[db] No se pudo resolver IPv4, usando URL original:', e.message);
    return connStr;
  }
}

// Crear el pool con la URL resuelta a IPv4
const resolvedURL = await resolveIPv4ConnectionString(process.env.DATABASE_URL);

// --- Pool Postgres (para queries del backend) ---
export const pool = new Pool({
  connectionString: resolvedURL,
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('[db] Error inesperado en el pool de Postgres:', err.message);
});

// Helper para queries
export async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  if (process.env.LOG_QUERIES === 'true') {
    console.log('[db]', { text, ms: Date.now() - start, rows: res.rowCount });
  }
  return res;
}

// --- Cliente Supabase con SERVICE ROLE (bypassea RLS) ---
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// --- Cliente Supabase con ANON key (para validar tokens) ---
export const supabaseAnon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
