// Rutas de administración. Arquitectura lista, funcionalidad NO implementada en v1.
// Protegidas con requireAuth + requireAdmin a nivel de index.js.
// Cuando se construyan las vistas admin, implementar aquí.
import { Router } from 'express';
import { query } from '../config/db.js';

const router = Router();

// GET /api/admin/users -> listar usuarios (solo lectura, ya disponible)
router.get('/users', async (req, res) => {
  const { rows } = await query(
    `SELECT id, email, name, role, created_at FROM users ORDER BY created_at DESC`
  );
  res.json(rows);
});

// Stubs preparados para v2 (devuelven 501 Not Implemented)
const notImplemented = (req, res) =>
  res.status(501).json({ error: 'No implementado en v1', endpoint: req.originalUrl });

router.put('/users/:id/role', notImplemented);     // cambiar rol de un usuario
router.delete('/users/:id', notImplemented);        // eliminar usuario
router.get('/stats', notImplemented);               // métricas agregadas del sistema
router.post('/instruments/import', notImplemented); // import masivo de instrumentos

export default router;
