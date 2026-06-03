// Panel de administración: auth propio + stats de usuarios.
// NO usa el sistema de autenticación de Supabase — tiene su propia validación.
import { Router } from 'express';
import { query } from '../config/db.js';
import { supabaseAdmin } from '../config/db.js';

const router = Router();

// Auth manejado en el frontend. El backend solo valida el token.
const ADMIN_TOKEN = 'portfolio-admin-secure-v1';

// Middleware de token (aplica a todas las rutas excepto /auth)
function requireAdminToken(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: 'No autorizado' });
  next();
}

// Todas las rutas requieren token
router.use(requireAdminToken);

// ── GET /api/admin/users ──────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    // Usuarios desde Supabase Auth — si falla, seguimos con datos de la DB
    let authUsers = [];
    try {
      const { data: authData, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
      if (!error) authUsers = authData.users;
    } catch { /* sin service role key — usamos solo DB */ }

    // Stats por usuario desde la DB
    const { rows: stats } = await query(`
      SELECT
        u.id,
        COUNT(DISTINCT p.id)  AS positions_count,
        COUNT(DISTINCT m.id)  AS movements_count,
        MAX(m.created_at)     AS last_movement_at
      FROM (SELECT DISTINCT user_id AS id FROM positions
            UNION
            SELECT DISTINCT user_id AS id FROM movements) u
      LEFT JOIN positions p  ON p.user_id  = u.id
      LEFT JOIN movements m  ON m.user_id  = u.id
      GROUP BY u.id
    `);
    const statsMap = Object.fromEntries(stats.map(s => [s.id, s]));

    const users = authUsers.map(u => ({
      id:              u.id,
      email:           u.email,
      created_at:      u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      confirmed:       !!u.email_confirmed_at,
      positions_count: Number(statsMap[u.id]?.positions_count  || 0),
      movements_count: Number(statsMap[u.id]?.movements_count  || 0),
      last_movement_at: statsMap[u.id]?.last_movement_at || null,
    }));

    res.json({ users });
  } catch (e) {
    console.error('[admin/users]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/admin/stats ──────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    let totalUsers = 0, activeUsers = 0, confirmedUsers = 0;
    try {
      const { data: authData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
      const now = new Date();
      const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
      totalUsers    = authData.users.length;
      activeUsers   = authData.users.filter(u => u.last_sign_in_at && u.last_sign_in_at > thirtyDaysAgo).length;
      confirmedUsers = authData.users.filter(u => u.email_confirmed_at).length;
    } catch { /* sin service role key */ }


    const { rows: dbStats } = await query(`
      SELECT
        COUNT(DISTINCT user_id) AS users_with_positions,
        COUNT(*)                AS total_positions
      FROM positions
    `);
    const { rows: movStats } = await query(`
      SELECT COUNT(*) AS total_movements FROM movements
    `);

    res.json({
      total_users:         totalUsers,
      active_users_30d:    activeUsers,
      confirmed_users:     confirmedUsers,
      users_with_positions: Number(dbStats[0].users_with_positions),
      total_positions:     Number(dbStats[0].total_positions),
      total_movements:     Number(movStats[0].total_movements),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/admin/users/:id ───────────────────────────────────────────────
// Elimina el usuario de Supabase Auth y todos sus datos del portafolio.
router.delete('/users/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Borrar datos del portafolio de la DB (en orden para respetar FKs)
    await query('DELETE FROM portfolio_snapshots WHERE user_id = $1', [id]);
    await query('DELETE FROM movements          WHERE user_id = $1', [id]);
    await query('DELETE FROM positions          WHERE user_id = $1', [id]);

    // Borrar el usuario de Supabase Auth
    const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
    if (error) throw error;

    res.status(204).end();
  } catch (e) {
    console.error('[admin/delete-user]', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
