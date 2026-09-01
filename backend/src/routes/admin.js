// Panel de administración: stats de usuarios e invitaciones de registro.
//
// Se monta detrás de requireAuth + requireAdmin en index.js, así que llega con
// un JWT de Supabase válido y rol 'admin' en public.users. Antes usaba un token
// hardcodeado que estaba en el repo público, lo que dejaba estos endpoints
// —incluido el borrado de usuarios— abiertos a cualquiera.
import { Router } from 'express';
import { query } from '../config/db.js';
import { supabaseAdmin } from '../config/db.js';
import { listRuns, getRun, retryJob, queueStatus } from '../services/priceQueue.js';
import { todayCL } from '../utils/dates.js';

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

// ── MAESTRO DE ACTIVOS ────────────────────────────────────────────────────────
// Cola de activos que entraron por cartola y todavía no tienen fuente de datos.
// Mientras están en pending_mapping solo los ve su creador; al mapearlos pasan a
// ser globales y el cron los empieza a actualizar al día siguiente.

const VALID_TYPES   = ['stock_us', 'stock_cl', 'crypto', 'fondo_mutuo_cl', 'afp'];
const VALID_SOURCES = ['alpha_vantage', 'coingecko', 'cmf', 'sp', 'manual', 'yahoo_finance'];

// GET /api/admin/instruments/pending
router.get('/instruments/pending', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT i.id, i.name, i.type, i.currency, i.status, i.meta, i.created_at,
             u.email AS created_by_email,
             (SELECT count(*) FROM positions p WHERE p.instrument_id = i.id) AS positions_count,
             (SELECT count(*) FROM transactions t WHERE t.instrument_id = i.id) AS tx_count
      FROM instruments i
      LEFT JOIN users u ON u.id = i.created_by
      WHERE i.status = 'pending_mapping' AND i.canonical_id IS NULL
      ORDER BY i.created_at DESC
    `);
    res.json({ instruments: rows });
  } catch (e) {
    console.error('[admin/instruments/pending]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/instruments/:id/map  { type, currency, api_source, external_id?, ticker?, meta? }
// Le asigna fuente de datos y lo activa. Desde el día siguiente entra al cron.
router.put('/instruments/:id/map', async (req, res) => {
  const { type, currency, api_source, external_id, ticker, meta, name } = req.body;

  if (type && !VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: `type debe ser uno de: ${VALID_TYPES.join(', ')}` });
  }
  if (api_source && !VALID_SOURCES.includes(api_source)) {
    return res.status(400).json({ error: `api_source debe ser uno de: ${VALID_SOURCES.join(', ')}` });
  }

  try {
    const { rows } = await query(
      `UPDATE instruments
         SET name        = COALESCE($2, name),
             type        = COALESCE($3, type),
             currency    = COALESCE($4, currency),
             api_source  = COALESCE($5, api_source),
             external_id = COALESCE($6, external_id),
             ticker      = COALESCE($7, ticker),
             meta        = COALESCE($8, meta),
             status      = 'active',
             fetch_enabled = TRUE
       WHERE id = $1 AND canonical_id IS NULL
       RETURNING *`,
      [req.params.id, name ?? null, type ?? null, currency ?? null, api_source ?? null,
       external_id ?? null, ticker ?? null, meta ? JSON.stringify(meta) : null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Instrumento no encontrado o ya fusionado' });
    res.json(rows[0]);
  } catch (e) {
    // Los índices únicos parciales rechazan mapearlo a una fuente que ya existe:
    // ese caso se resuelve fusionando, no mapeando.
    if (e.code === '23505' || /duplicate key/i.test(e.message)) {
      return res.status(409).json({
        error: 'Ya existe un instrumento con esa fuente. Fusionalo en vez de mapearlo.',
        detail: e.message,
      });
    }
    res.status(400).json({ error: e.message });
  }
});

// POST /api/admin/instruments/:id/merge  { target_id }
// Fusiona el activo en otro: repunta el ledger, suma la historia y reconstruye
// las posiciones. El origen queda con canonical_id, no se borra.
router.post('/instruments/:id/merge', async (req, res) => {
  const targetId = Number(req.body?.target_id);
  if (!targetId) return res.status(400).json({ error: 'target_id es obligatorio' });

  try {
    const { rows } = await query('SELECT * FROM merge_instruments($1, $2)', [req.params.id, targetId]);
    res.json({ merged_into: targetId, ...rows[0] });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/admin/instruments/search?q=  -> para elegir destino de una fusión
router.get('/instruments/search', async (req, res) => {
  const q = String(req.query?.q || '').trim();
  if (q.length < 2) return res.json({ instruments: [] });
  const { rows } = await query('SELECT * FROM match_instruments($1, NULL, 10)', [q]);
  res.json({ instruments: rows });
});

// ── MANTENEDOR DE INSTRUMENTOS ────────────────────────────────────────────────
// La cola de pending_mapping de arriba pasa a ser un filtro de esta tabla.

// GET /api/admin/instruments?q=&status=&type=&api_source=&limit=&offset=
router.get('/instruments', async (req, res) => {
  const { q, status, type, api_source } = req.query;
  const limit  = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const clauses = ['TRUE'];
  const params = [];
  if (status)     { params.push(status);     clauses.push(`i.status = $${params.length}`); }
  if (type)       { params.push(type);       clauses.push(`i.type = $${params.length}`); }
  if (api_source) { params.push(api_source); clauses.push(`i.api_source = $${params.length}`); }
  // La búsqueda usa el mismo índice de trigramas que el matching de cartolas.
  if (q && q.trim().length >= 2) {
    params.push(q.trim());
    clauses.push(`i.id IN (SELECT id FROM match_instruments($${params.length}, NULL, 200))`);
  }

  try {
    const { rows } = await query(
      `SELECT i.id, i.name, i.alias, i.type, i.ticker, i.currency, i.api_source,
              i.external_id, i.status, i.fetch_enabled, i.canonical_id, i.meta,
              i.created_at, u.email AS created_by_email,
              lp.price_clp, lp.price_usd, lp.date AS price_date, lp.is_stale,
              lp.source AS price_source, lp.fetched_at AS price_fetched_at,
              (SELECT count(DISTINCT p.user_id) FROM positions p WHERE p.instrument_id = i.id)::int AS holders,
              (SELECT count(*) FROM transactions t WHERE t.instrument_id = i.id)::int AS tx_count,
              can.name AS canonical_name
       FROM instruments i
       LEFT JOIN users u        ON u.id = i.created_by
       LEFT JOIN latest_prices lp ON lp.instrument_id = i.id
       LEFT JOIN instruments can ON can.id = i.canonical_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY (i.status = 'pending_mapping') DESC, i.name
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    const { rows: [{ total }] } = await query(
      `SELECT count(*)::int AS total FROM instruments i WHERE ${clauses.join(' AND ')}`, params
    );
    res.json({ instruments: rows, total, limit, offset });
  } catch (e) {
    console.error('[admin/instruments]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/instruments/:id  -> edición completa del maestro
router.put('/instruments/:id', async (req, res) => {
  const { name, alias, type, ticker, currency, api_source, external_id, meta, status, fetch_enabled } = req.body;

  if (type && !VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: `type debe ser uno de: ${VALID_TYPES.join(', ')}` });
  }
  if (api_source && !VALID_SOURCES.includes(api_source)) {
    return res.status(400).json({ error: `api_source debe ser uno de: ${VALID_SOURCES.join(', ')}` });
  }
  if (status && !['active','pending_mapping','deprecated'].includes(status)) {
    return res.status(400).json({ error: 'status inválido' });
  }

  try {
    const { rows } = await query(
      `UPDATE instruments SET
         name          = COALESCE($2, name),
         alias         = $3,
         type          = COALESCE($4, type),
         ticker        = $5,
         currency      = COALESCE($6, currency),
         api_source    = COALESCE($7, api_source),
         external_id   = $8,
         meta          = COALESCE($9, meta),
         status        = COALESCE($10, status),
         fetch_enabled = COALESCE($11, fetch_enabled)
       WHERE id = $1 RETURNING *`,
      [req.params.id, name ?? null, alias ?? null, type ?? null, ticker ?? null,
       currency ?? null, api_source ?? null, external_id ?? null,
       meta ? JSON.stringify(meta) : null, status ?? null,
       typeof fetch_enabled === 'boolean' ? fetch_enabled : null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Instrumento no encontrado' });
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({
        error: 'Ya existe otro instrumento con esa fuente o ticker. Fusionalos en vez de duplicarlos.',
        detail: e.message,
      });
    }
    res.status(400).json({ error: e.message });
  }
});

// ── MANTENEDOR DE CUSTODIOS ───────────────────────────────────────────────────

// GET /api/admin/custodians
router.get('/custodians', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT c.id, c.slug, c.name, c.country, c.canonical_id, c.created_at,
             u.email AS created_by_email,
             can.name AS canonical_name,
             (SELECT count(*) FROM positions p WHERE p.custodian_id = c.id)::int    AS positions_count,
             (SELECT count(*) FROM transactions t WHERE t.custodian_id = c.id)::int AS tx_count,
             (SELECT count(*) FROM statements s WHERE s.custodian_id = c.id)::int   AS statements_count
      FROM custodians c
      LEFT JOIN users u       ON u.id = c.created_by
      LEFT JOIN custodians can ON can.id = c.canonical_id
      ORDER BY (c.canonical_id IS NOT NULL), (c.id = 0) DESC, c.name
    `);
    res.json({ custodians: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/custodians/:id
router.put('/custodians/:id', async (req, res) => {
  const name = req.body?.name != null ? String(req.body.name).trim() : null;
  const country = req.body?.country != null ? String(req.body.country).trim().toUpperCase().slice(0, 2) : null;
  if (name != null && (name.length < 2 || name.length > 80)) {
    return res.status(400).json({ error: 'El nombre debe tener entre 2 y 80 caracteres' });
  }
  try {
    const { rows } = await query(
      `UPDATE custodians SET name = COALESCE($2, name), country = COALESCE($3, country)
       WHERE id = $1 RETURNING *`,
      [req.params.id, name, country]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Custodio no encontrado' });
    res.json(rows[0]);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/admin/custodians/:id/merge  { target_id }
router.post('/custodians/:id/merge', async (req, res) => {
  const targetId = Number(req.body?.target_id);
  if (!targetId) return res.status(400).json({ error: 'target_id es obligatorio' });
  try {
    const { rows } = await query('SELECT * FROM merge_custodians($1, $2)', [req.params.id, targetId]);
    res.json({ merged_into: targetId, ...rows[0] });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── EJECUCIONES DEL CRON ──────────────────────────────────────────────────────

// GET /api/admin/cron/runs
router.get('/cron/runs', async (req, res) => {
  try {
    const [runs, cola] = await Promise.all([
      listRuns(Math.min(Number(req.query.limit) || 40, 200)),
      queueStatus(req.query.date || todayCL()),
    ]);
    res.json({ runs, cola });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/cron/runs/:id  -> la corrida con los jobs que tocó
router.get('/cron/runs/:id', async (req, res) => {
  try {
    const r = await getRun(req.params.id);
    if (!r) return res.status(404).json({ error: 'Ejecución no encontrada' });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/cron/jobs/:id/retry  -> reencolar sin esperar la corrida siguiente
router.post('/cron/jobs/:id/retry', async (req, res) => {
  try {
    const j = await retryJob(req.params.id);
    if (!j) return res.status(404).json({ error: 'Job no encontrado' });
    res.json(j);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
