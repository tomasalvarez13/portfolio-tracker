// Resumen, snapshots, breakdown y rentabilidad del usuario autenticado.
import { Router } from 'express';
import {
  getSummary, getSnapshots, computeBreakdown,
  getRentabilidad, getMonthlyRentabilidad, computeAndSaveSnapshot,
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

// POST /api/portfolio/snapshot -> fuerza snapshot del día (útil al sembrar datos)
router.post('/snapshot', async (req, res) => {
  const snap = await computeAndSaveSnapshot(req.user.id, req.body?.date);
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

export default router;
