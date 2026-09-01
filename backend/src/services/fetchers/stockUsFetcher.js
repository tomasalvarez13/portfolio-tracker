// Acciones / ETFs USA via Yahoo Finance (endpoint chart directo).

import { fetchYahooChartPrice, fetchYahooChartSerie } from './yahooChart.js';

/**
 * Cotización actual de un ticker USA.
 * @param {string} ticker - ej: 'AAPL', 'SPY'
 * @returns {Promise<{price: number, date: string, currency: string}>}
 */
export async function fetchStockQuote(ticker) {
  const { price, date } = await fetchYahooChartPrice(ticker);
  return { price, date, currency: 'USD' };
}

/**
 * Cierres diarios de un ticker USA en un rango.
 * @returns {Promise<Array<{date: string, price: number}>>}
 */
export async function fetchSerieStockQuote(ticker, since, until) {
  return fetchYahooChartSerie(ticker, since, until);
}
