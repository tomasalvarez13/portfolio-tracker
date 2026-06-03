// Entry point del backend Express.
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import dotenv from 'dotenv';

import { requireAuth, requireAdmin } from './config/auth.js';
import instrumentsRouter from './routes/instruments.js';
import positionsRouter from './routes/positions.js';
import movementsRouter from './routes/movements.js';
import pricesRouter from './routes/prices.js';
import portfolioRouter from './routes/portfolio.js';
import marketRouter from './routes/market.js';
import adminRouter from './routes/admin.js';
import aiRouter from './routes/ai.js';
import { runDailyJob } from './jobs/dailyPriceFetch.js';

dotenv.config();

const app = express();
app.use(express.json());

// CORS: abierto a todos los orígenes.
// La seguridad está en el JWT de Supabase que valida cada request.
app.use(cors({
  origin: (origin, cb) => cb(null, true),
  credentials: true,
}));

// Healthcheck público
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// Rutas protegidas (requieren JWT de Supabase)
app.use('/api/instruments', requireAuth, instrumentsRouter);
app.use('/api/positions', requireAuth, positionsRouter);
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

// Rutas admin (sistema de auth propio, NO usa Supabase JWT)
app.use('/api/admin', adminRouter);

// Handler de errores
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: 'Error interno', detail: err.message });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[server] Backend escuchando en :${PORT}`);

  // Cron diario de precios
  if (process.env.RUN_CRON !== 'false') {
    const schedule = process.env.PRICE_CRON_SCHEDULE || '30 8 * * 1-5';
    const tz = process.env.CRON_TIMEZONE || 'America/Santiago';
    if (cron.validate(schedule)) {
      cron.schedule(schedule, () => {
        runDailyJob().catch((e) => console.error('[cron] fallo:', e.message));
      }, { timezone: tz });
      console.log(`[cron] Programado "${schedule}" (${tz})`);
    } else {
      console.warn(`[cron] PRICE_CRON_SCHEDULE inválido: "${schedule}", cron no programado`);
    }
  } else {
    console.log('[cron] Desactivado (RUN_CRON=false)');
  }
});
