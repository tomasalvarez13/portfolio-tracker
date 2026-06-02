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
import { runDailyJob } from './jobs/dailyPriceFetch.js';

dotenv.config();

const app = express();
app.use(express.json());

// CORS: acepta orígenes configurados + cualquier subdominio vercel.app
const staticOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173')
  .split(',').map((s) => s.trim());

app.use(cors({
  credentials: true,
  origin: (origin, cb) => {
    // Permitir requests sin origin (curl, Postman, mobile apps)
    if (!origin) return cb(null, true);
    // Permitir orígenes en la lista
    if (staticOrigins.includes(origin)) return cb(null, true);
    // Permitir cualquier subdominio de vercel.app
    if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin)) return cb(null, true);
    // Permitir localhost en cualquier puerto (desarrollo)
    if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
    cb(new Error(`CORS bloqueado para origen: ${origin}`));
  },
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

// Rutas admin (preparadas; la mayoría responde 501 en v1)
app.use('/api/admin', requireAuth, requireAdmin, adminRouter);

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
