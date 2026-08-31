// Rentabilidad por custodio y por activo.
//
// Se apoya en `position_snapshots`, que empezó a poblarse en §3.3: el rango
// disponible arranca ahí, no en el historial completo del portafolio.
import { Router } from 'express';
import { byCustodian, byInstrument, availableRange } from '../services/analyticsService.js';
import { todayCL, addDays } from '../utils/dates.js';

const router = Router();

/** Rango por defecto: los últimos 90 días, acotado a lo que hay. */
async function resolverRango(userId, q) {
  const disp = await availableRange(userId);
  const hasta = q.to   || disp.hasta || todayCL();
  const desde = q.from || (disp.desde && disp.desde > addDays(hasta, -90)
    ? disp.desde
    : addDays(hasta, -90));
  return { from: desde, to: hasta, disponible: disp };
}

// GET /api/analytics/range  -> qué rango tiene datos
router.get('/range', async (req, res) => {
  res.json(await availableRange(req.user.id));
});

// GET /api/analytics/by-custodian?from=&to=
router.get('/by-custodian', async (req, res) => {
  try {
    const { from, to, disponible } = await resolverRango(req.user.id, req.query);
    res.json({ ...(await byCustodian(req.user.id, from, to)), disponible });
  } catch (e) {
    console.error('[analytics/by-custodian]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/analytics/by-instrument?from=&to=
router.get('/by-instrument', async (req, res) => {
  try {
    const { from, to, disponible } = await resolverRango(req.user.id, req.query);
    res.json({ ...(await byInstrument(req.user.id, from, to)), disponible });
  } catch (e) {
    console.error('[analytics/by-instrument]', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
