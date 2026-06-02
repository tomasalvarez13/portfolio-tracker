// Job diario: fetch de todos los precios + snapshot del patrimonio de cada usuario.
// Se registra con node-cron desde index.js, y también se puede correr a mano:
//   npm run fetch:prices
import { refreshAllPrices } from '../services/priceService.js';
import { snapshotAllUsers } from '../services/portfolioService.js';

export async function runDailyJob() {
  console.log(`[cron] Iniciando fetch diario de precios @ ${new Date().toISOString()}`);
  const report = await refreshAllPrices();
  console.log('[cron] Precios:', report);
  const snaps = await snapshotAllUsers(report.date);
  console.log(`[cron] Snapshots generados para ${snaps.length} usuario(s)`);
  return { report, snaps };
}

// Permite ejecución directa: node src/jobs/dailyPriceFetch.js
if (import.meta.url === `file://${process.argv[1]}`) {
  runDailyJob()
    .then(() => process.exit(0))
    .catch((e) => { console.error('[cron] Error:', e); process.exit(1); });
}
