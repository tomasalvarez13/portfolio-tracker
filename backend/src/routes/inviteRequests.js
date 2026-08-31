// Endpoint público: solicitar una invitación para registrarse.
//
// Va montado ANTES de requireAuth, porque quien solicita todavía no tiene cuenta.
// Al ser una escritura sin autenticación lleva validación estricta y límite por
// IP, y cada handler atrapa sus errores: una promesa rechazada acá tumbaría el
// proceso entero de Render.
import { Router } from 'express';
import { query } from '../config/db.js';

const router = Router();

const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME    = 100;
const MAX_MESSAGE = 500;

// ── Límite por IP ─────────────────────────────────────────────────────────────
// En memoria: se reinicia con el proceso y no se comparte entre instancias, pero
// alcanza para frenar el abuso obvio en un servicio de una sola instancia.
const WINDOW_MS = 60 * 60 * 1000;   // 1 hora
const MAX_HITS  = 5;
const hits = new Map();             // ip -> number[] (timestamps)

function rateLimited(ip) {
  const now = Date.now();

  // Poda oportunista para que el Map no crezca sin techo.
  for (const [k, times] of hits) {
    const fresh = times.filter((t) => now - t < WINDOW_MS);
    if (fresh.length) hits.set(k, fresh);
    else hits.delete(k);
  }

  const mine = hits.get(ip) || [];
  if (mine.length >= MAX_HITS) return true;
  mine.push(now);
  hits.set(ip, mine);
  return false;
}

// ── POST /api/invite-requests  { email, name?, message? } ─────────────────────
router.post('/', async (req, res) => {
  try {
    const email   = String(req.body?.email || '').trim().toLowerCase();
    const name    = req.body?.name    ? String(req.body.name).trim().slice(0, MAX_NAME)       : null;
    const message = req.body?.message ? String(req.body.message).trim().slice(0, MAX_MESSAGE) : null;

    if (!EMAIL_RE.test(email) || email.length > 255) {
      return res.status(400).json({ error: 'Correo inválido' });
    }

    if (rateLimited(req.ip)) {
      return res.status(429).json({ error: 'Demasiadas solicitudes. Probá de nuevo más tarde.' });
    }

    // Una fila por correo: repetir la solicitud actualiza los datos en vez de
    // apilar filas. No se reabre una ya resuelta, para que aprobar o rechazar
    // no se pueda deshacer desde afuera.
    await query(
      `INSERT INTO invitation_requests (email, name, message)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE
         SET name    = COALESCE(EXCLUDED.name, invitation_requests.name),
             message = COALESCE(EXCLUDED.message, invitation_requests.message)
       WHERE invitation_requests.status = 'pending'`,
      [email, name, message]
    );

    // Respuesta siempre igual: no revelamos si el correo ya estaba invitado,
    // ya solicitó o fue rechazado.
    res.status(202).json({ ok: true });
  } catch (e) {
    console.error('[invite-requests]', e.message);
    res.status(500).json({ error: 'No se pudo registrar la solicitud' });
  }
});

export default router;
