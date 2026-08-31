// Helper compartido: precio actual vía el endpoint "chart" público de Yahoo Finance.
// A diferencia de yahoo-finance2 (.quote()), este endpoint no exige un "crumb" de
// sesión, lo que evita el 429 "Failed to get crumb" que bloquea IPs de hosting
// compartido como Render free tier.

import { todayCL } from '../../utils/dates.js';

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

/**
 * Cotización actual de un símbolo Yahoo Finance (ej: 'AAPL', 'COLBUN.SN').
 * @param {string} symbol
 * @returns {Promise<{price: number, date: string}>}
 */
export async function fetchYahooChartPrice(symbol) {
  const res = await fetch(`${BASE}/${encodeURIComponent(symbol)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`Yahoo Finance (chart) respondió ${res.status} para ${symbol}`);
  const data = await res.json();

  if (data?.chart?.error) {
    throw new Error(`Yahoo Finance (chart): ${data.chart.error.description || 'error'} para ${symbol}`);
  }

  const meta = data?.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  const date  = meta?.regularMarketTime
    ? new Date(meta.regularMarketTime * 1000).toISOString().slice(0, 10)
    : todayCL();

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Yahoo Finance (chart): sin precio para ${symbol}`);
  }

  return { price, date };
}
