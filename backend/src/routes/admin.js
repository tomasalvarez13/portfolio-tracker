// Panel de administración: stats de usuarios e invitaciones de registro.
//
// Se monta detrás de requireAuth + requireAdmin en index.js, así que llega con
// un JWT de Supabase válido y rol 'admin' en public.users. Antes usaba un token
// hardcodeado que estaba en el repo público, lo que dejaba estos endpoints
// —incluido el borrado de usuarios— abiertos a cualquiera.
import { Router } from 'express';
import { query } from '../config/db.js';
import { supabaseAdmin } from '../config/db.js';

const router = Router();

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
    // El email lo necesitamos antes de borrar la fila, para revocar la invitación.
    const { rows: [u] } = await query('SELECT email FROM users WHERE id = $1', [id]);

    await query('DELETE FROM portfolio_snapshots WHERE user_id = $1', [id]);
    await query('DELETE FROM movements          WHERE user_id = $1', [id]);
    await query('DELETE FROM positions          WHERE user_id = $1', [id]);

    // Sin esto podría volver a registrarse de inmediato con la misma invitación.
    if (u?.email) await query('DELETE FROM invitations WHERE email = lower($1)', [u.email]);

    // Borrar el usuario de Supabase Auth
    const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
    if (error) throw error;

    res.status(204).end();
  } catch (e) {
    console.error('[admin/delete-user]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── INVITACIONES ──────────────────────────────────────────────────────────────
// Solo los correos de esta tabla pueden registrarse. Lo hace cumplir el hook
// "Before User Created" de Supabase (ver backend/src/db/invitations.sql), no el
// frontend: el signup va del browser directo a Supabase y saltearía cualquier
// chequeo en React.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /api/admin/invitations
router.get('/invitations', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT i.id, i.email, i.note, i.created_at, i.used_at,
             u.id AS user_id
      FROM invitations i
      LEFT JOIN users u ON lower(u.email) = i.email
      ORDER BY i.created_at DESC
    `);
    res.json({ invitations: rows });
  } catch (e) {
    console.error('[admin/invitations]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/invitations  { email, note? }
router.post('/invitations', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const note  = req.body?.note ?? null;

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Correo inválido' });
  }

  try {
    const { rows } = await query(
      `INSERT INTO invitations (email, note) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET note = COALESCE(EXCLUDED.note, invitations.note)
       RETURNING *`,
      [email, note]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('[admin/invitations:post]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/admin/invitations/:id
// Revoca la invitación. Si la persona ya se registró, su cuenta sigue viva:
// para sacarla del todo hay que borrar el usuario.
router.delete('/invitations/:id', async (req, res) => {
  try {
    const { rowCount } = await query('DELETE FROM invitations WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Invitación no encontrada' });
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── SOLICITUDES DE INVITACIÓN ─────────────────────────────────────────────────
// Las crea el endpoint público POST /api/invite-requests. Aprobar una crea la
// invitación correspondiente.

// GET /api/admin/invite-requests
router.get('/invite-requests', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT id, email, name, message, status, created_at, resolved_at
      FROM invitation_requests
      ORDER BY (status = 'pending') DESC, created_at DESC
    `);
    res.json({ requests: rows });
  } catch (e) {
    console.error('[admin/invite-requests]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/invite-requests/:id/approve
// Un solo statement para que marcar la solicitud y crear la invitación no puedan
// quedar desfasados: el helper query() no abre transacciones.
router.post('/invite-requests/:id/approve', async (req, res) => {
  try {
    const { rows } = await query(
      `WITH req AS (
         UPDATE invitation_requests
            SET status = 'approved', resolved_at = NOW()
          WHERE id = $1 AND status = 'pending'
         RETURNING email, name
       )
       INSERT INTO invitations (email, note)
       SELECT email, COALESCE('Solicitud aprobada — ' || name, 'Solicitud aprobada')
       FROM req
       ON CONFLICT (email) DO UPDATE SET note = EXCLUDED.note
       RETURNING *`,
      [req.params.id]
    );
    if (!rows[0]) {
      return res.status(409).json({ error: 'La solicitud no existe o ya fue resuelta' });
    }
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('[admin/invite-requests:approve]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/invite-requests/:id/reject
router.post('/invite-requests/:id/reject', async (req, res) => {
  try {
    const { rows } = await query(
      `UPDATE invitation_requests SET status = 'rejected', resolved_at = NOW()
        WHERE id = $1 AND status = 'pending' RETURNING *`,
      [req.params.id]
    );
    if (!rows[0]) {
      return res.status(409).json({ error: 'La solicitud no existe o ya fue resuelta' });
    }
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
