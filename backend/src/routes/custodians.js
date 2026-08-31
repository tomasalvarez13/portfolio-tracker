// Maestro de custodios (global). Lectura para cualquier usuario autenticado;
// alta libre, porque el form de posiciones deja crear el propio si no está en la
// lista. La lista real es corta (~20 en Chile) y el selector muestra los
// existentes primero, así que el riesgo de tipeos es bajo — y si aparecen
// duplicados se fusionan con canonical_id sin borrar nada.
import { Router } from 'express';
import { query } from '../config/db.js';

const router = Router();

/** 'Banchile Inversiones' -> 'banchile-inversiones' */
function slugify(name) {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // saca acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

// GET /api/custodians
// El centinela id=0 ("Sin custodio") va primero para que sea el default visible.
router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT id, slug, name, country
     FROM custodians
     WHERE canonical_id IS NULL
     ORDER BY (id = 0) DESC, name`
  );
  res.json(rows);
});

// POST /api/custodians  { name, country? }
router.post('/', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const country = String(req.body?.country || 'CL').trim().toUpperCase().slice(0, 2);

  if (name.length < 2 || name.length > 80) {
    return res.status(400).json({ error: 'El nombre debe tener entre 2 y 80 caracteres' });
  }

  const slug = slugify(name);
  if (!slug) return res.status(400).json({ error: 'Nombre inválido' });

  try {
    // Si ya existe ese slug devolvemos el que está, en vez de un 409: para el
    // form es lo mismo y evita que el usuario tenga que adivinar el nombre exacto.
    const { rows } = await query(
      `INSERT INTO custodians (slug, name, country, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO UPDATE SET slug = custodians.slug
       RETURNING id, slug, name, country`,
      [slug, name, country, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
