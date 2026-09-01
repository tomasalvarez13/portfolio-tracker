// Helper compartido: precios vía el endpoint "chart" público de Yahoo Finance.
// A diferencia de yahoo-finance2 (.quote()), este endpoint no exige un "crumb" de
// sesión, lo que evita el 429 "Failed to get crumb" que bloquea IPs de hosting
// compartido como Render free tier.
//
// El mismo endpoint sirve el spot (meta.regularMarketPrice) y la serie diaria
// (period1/period2 + interval=1d). La serie es lo que permite llenar la ventana
// de un instrumento con un solo request en vez de uno por fecha.

import { todayCL } from '../../utils/dates.js';
import { fetchConTimeout } from './http.js';

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

/** Medianoche UTC de una fecha ISO, en segundos: lo que espera period1/period2. */
const aEpoch = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);

async function pedirChart(symbol, params) {
  const qs = params ? `?${params}` : '';
  const res = await fetchConTimeout(`${BASE}/${encodeURIComponent(symbol)}${qs}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`Yahoo Finance (chart) respondió ${res.status} para ${symbol}`);
  const data = await res.json();

  if (data?.chart?.error) {
    throw new Error(`Yahoo Finance (chart): ${data.chart.error.description || 'error'} para ${symbol}`);
  }
  return data?.chart?.result?.[0];
}

/**
 * Cotización actual de un símbolo Yahoo Finance (ej: 'AAPL', 'COLBUN.SN').
 * @param {string} symbol
 * @returns {Promise<{price: number, date: string}>}
 */
export async function fetchYahooChartPrice(symbol) {
  const meta = (await pedirChart(symbol))?.meta;
  const price = meta?.regularMarketPrice;
  const date  = meta?.regularMarketTime
    ? new Date(meta.regularMarketTime * 1000).toISOString().slice(0, 10)
    : todayCL();

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Yahoo Finance (chart): sin precio para ${symbol}`);
  }

  return { price, date };
}

/**
 * Cierres diarios de un símbolo en un rango de fechas.
 *
 * period2 va corrido un día porque el rango de Yahoo es semiabierto: sin eso el
 * último día pedido no vendría. Los días sin cierre (feriados, suspensiones) no
 * aparecen en el resultado, que es justo lo que el llamador necesita saber.
 *
 * @param {string} symbol
 * @param {string} since - 'YYYY-MM-DD'
 * @param {string} until - 'YYYY-MM-DD', inclusive
 * @returns {Promise<Array<{date: string, price: number}>>} ordenado por fecha
 */
export async function fetchYahooChartSerie(symbol, since, until) {
  const params = new URLSearchParams({
    period1: String(aEpoch(since)),
    period2: String(aEpoch(until) + 86_400),
    interval: '1d',
  });

  const result = await pedirChart(symbol, params.toString());
  const stamps = result?.timestamp || [];
  const cierres = result?.indicators?.quote?.[0]?.close || [];

  const salida = [];
  for (let i = 0; i < stamps.length; i++) {
    const price = cierres[i];
    if (!Number.isFinite(price) || price <= 0) continue;
    salida.push({ date: new Date(stamps[i] * 1000).toISOString().slice(0, 10), price });
  }
  return salida.sort((a, b) => (a.date < b.date ? -1 : 1));
}
