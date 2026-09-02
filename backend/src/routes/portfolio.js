// Resumen, snapshots, breakdown y rentabilidad del usuario autenticado.
import { Router } from 'express';
import {
  getSummary, getSnapshots, computeBreakdown,
  getRentabilidad, getMonthlyRentabilidad, computeAndSaveSnapshot,
  computeTWR,
} from '../services/portfolioService.js';

const router = Router();

// GET /api/portfolio/summary
router.get('/summary', async (req, res) => {
  res.json(await getSummary(req.user.id));
});

// GET /api/portfolio/snapshots?from=&to=
router.get('/snapshots', async (req, res) => {
  const { from, to } = req.query;
  res.json(await getSnapshots(req.user.id, from, to));
});

// GET /api/portfolio/breakdown
router.get('/breakdown', async (req, res) => {
  res.json(await computeBreakdown(req.user.id));
});

// POST /api/portfolio/snapshot -> fuerza el snapshot del día
//
// Ya no acepta `date` del body. Era el único camino donde el usuario elegía la
// fecha directamente, y `computeAndSaveSnapshot` la usaba para revalorizar toda
// su cartera a precio de hoy y estampar el resultado en esa fecha: un borrador
// de historia propia disparable con un POST. El clamp del servicio ya lo cubre
// hacia atrás, pero acá tampoco tiene sentido aceptarlo hacia adelante.
router.post('/snapshot', async (req, res) => {
  const snap = await computeAndSaveSnapshot(req.user.id);
  res.json(snap);
});

// GET /api/portfolio/rentabilidad?from=&to=
router.get('/rentabilidad', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from y to son obligatorios' });
  res.json(await getRentabilidad(req.user.id, from, to));
});

// GET /api/portfolio/rentabilidad/monthly?from=&to=
router.get('/rentabilidad/monthly', async (req, res) => {
  const { from, to } = req.query;
  res.json(await getMonthlyRentabilidad(req.user.id, from, to));
});

// GET /api/portfolio/twr?from=&to=  -> rentabilidad TWR del rango
router.get('/twr', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from y to son obligatorios' });
  res.json(await computeTWR(req.user.id, from, to));
});

export default router;
