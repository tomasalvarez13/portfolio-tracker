// Acciones chilenas (Bolsa de Santiago) via Yahoo Finance (endpoint chart directo).
// Tickers con sufijo .SN  ej: SALFACORP.SN, COLBUN.SN, PUCOBRE.SN

import { fetchYahooChartPrice, fetchYahooChartSerie } from './yahooChart.js';

const simbolo = (ticker) => (ticker.toUpperCase().endsWith('.SN') ? ticker : `${ticker}.SN`);

/**
 * Precio actual de una acción chilena.
 * @param {string} ticker - sin sufijo, ej: 'SALFACORP' (se agrega .SN)
 * @returns {Promise<{price: number, date: string, currency: string}>}
 */
export async function fetchStockCl(ticker) {
  const symbol = simbolo(ticker);
  const { price, date } = await fetchYahooChartPrice(symbol);
  return { price, date, currency: 'CLP' };
}

/**
 * Cierres diarios de una acción chilena en un rango.
 * @returns {Promise<Array<{date: string, price: number}>>}
 */
export async function fetchSerieStockCl(ticker, since, until) {
  return fetchYahooChartSerie(simbolo(ticker), since, until);
}
