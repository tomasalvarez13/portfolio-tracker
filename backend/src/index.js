// Entry point del backend Express.
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import { requireAuth, requireAdmin } from './config/auth.js';
import instrumentsRouter from './routes/instruments.js';
import positionsRouter from './routes/positions.js';
import custodiansRouter from './routes/custodians.js';
import statementsRouter from './routes/statements.js';
import movementsRouter from './routes/movements.js';
import pricesRouter from './routes/prices.js';
import pricesCronRouter from './routes/pricesCron.js';
import inviteRequestsRouter from './routes/inviteRequests.js';
import portfolioRouter from './routes/portfolio.js';
import marketRouter from './routes/market.js';
import adminRouter from './routes/admin.js';
import aiRouter from './routes/ai.js';

dotenv.config();

const app = express();
app.use(express.json());

// Render corre detrás de su propio proxy: sin esto req.ip es el del proxy y el
// límite por IP de /api/invite-requests trataría a todo el mundo como un cliente.
app.set('trust proxy', 1);

// CORS: abierto a todos los orígenes.
// La seguridad está en el JWT de Supabase que valida cada request.
app.use(cors({
  origin: (origin, cb) => cb(null, true),
  credentials: true,
}));

// Healthcheck público
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// Endpoints del scraper externo (sin JWT, solo CRON_SECRET)
app.use('/api/prices', pricesCronRouter);

// Solicitud de invitación: público, quien la pide todavía no tiene cuenta.
app.use('/api/invite-requests', inviteRequestsRouter);

// Rutas protegidas (requieren JWT de Supabase)
app.use('/api/instruments', requireAuth, instrumentsRouter);
app.use('/api/positions', requireAuth, positionsRouter);
app.use('/api/custodians', requireAuth, custodiansRouter);
app.use('/api/statements', requireAuth, statementsRouter);
app.use('/api/movements', requireAuth, movementsRouter);
app.use('/api/prices', requireAuth, pricesRouter);
app.use('/api/portfolio', requireAuth, portfolioRouter);
app.use('/api/market', requireAuth, marketRouter);

// Rutas de IA
app.use('/api/ai', requireAuth, aiRouter);

// Endpoint para el cron externo (GitHub Actions). Protegido por CRON_SECRET.
app.post('/api/cron/prices', async (req, res) => {
  const secret = process.env.CRON_SECRET || 'cron-dev-secret';
  const provided = req.headers['x-cron-secret'] || req.body?.secret;
  if (provided !== secret) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { runDailyJob } = await import('./jobs/dailyPriceFetch.js');
    const result = await runDailyJob();
    res.json({ ok: true, ...result.report });
  } catch (e) {
    console.error('[cron/prices]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Rutas admin: JWT de Supabase + rol 'admin' en public.users.
app.use('/api/admin', requireAuth, requireAdmin, adminRouter);

// Handler de errores
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: 'Error interno', detail: err.message });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[server] Backend escuchando en :${PORT}`);
  // El cron in-process se sacó a propósito. Render free duerme la instancia por
  // inactividad, así que node-cron no dispara de forma confiable — y cuando la
  // instancia despertaba podía correr en paralelo con el tick de GitHub Actions
  // sobre los mismos precios. Ahora GitHub Actions es la única fuente, y el
  // advisory lock de la cola cubre el caso de que igual se solapen.
  //
  // Para correrlo a mano: npm run fetch:prices
});
