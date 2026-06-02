// Middleware de autenticación basado en Supabase Auth.
// El frontend envía el JWT de Supabase en el header Authorization: Bearer <token>.
// Validamos el token con Supabase y adjuntamos req.user = { id, email, role }.

import { supabaseAnon, query } from './db.js';

/** Exige usuario autenticado. Adjunta req.user. */
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Falta token de autenticación' });

    const { data, error } = await supabaseAnon.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }

    // Rol desde public.users (default 'user' si aún no existe la fila)
    let role = 'user';
    try {
      const { rows } = await query('SELECT role FROM users WHERE id = $1', [data.user.id]);
      if (rows[0]?.role) role = rows[0].role;
    } catch { /* si la tabla no responde, asumimos user */ }

    req.user = { id: data.user.id, email: data.user.email, role };
    next();
  } catch (e) {
    console.error('[auth] error validando token:', e.message);
    res.status(401).json({ error: 'No autorizado' });
  }
}

/** Exige rol admin. Debe ir DESPUÉS de requireAuth. */
export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Requiere privilegios de administrador' });
  }
  next();
}
