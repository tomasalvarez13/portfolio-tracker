// Acciones chilenas (Bolsa de Santiago) via Yahoo Finance (endpoint chart directo).
// Tickers con sufijo .SN  ej: SALFACORP.SN, COLBUN.SN, PUCOBRE.SN

import { fetchYahooChartPrice } from './yahooChart.js';

/**
 * Precio actual de una acción chilena.
 * @param {string} ticker - sin sufijo, ej: 'SALFACORP' (se agrega .SN)
 * @returns {Promise<{price: number, date: string, currency: string}>}
 */
export async function fetchStockCl(ticker) {
  const symbol = ticker.toUpperCase().endsWith('.SN') ? ticker : `${ticker}.SN`;
  const { price, date } = await fetchYahooChartPrice(symbol);
  return { price, date, currency: 'CLP' };
}
