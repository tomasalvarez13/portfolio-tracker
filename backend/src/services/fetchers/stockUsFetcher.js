// Acciones / ETFs USA via Yahoo Finance (yahoo-finance2).
// Sin límite diario estricto (a diferencia de Alpha Vantage, 25 req/día en plan free).

import YahooFinance from 'yahoo-finance2';

// Instancia singleton — requerida por v3
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

/**
 * Cotización actual de un ticker USA.
 * @param {string} ticker - ej: 'AAPL', 'SPY'
 * @returns {Promise<{price: number, date: string, currency: string}>}
 */
export async function fetchStockQuote(ticker) {
  const quote = await yf.quote(ticker, {}, { validateResult: false });

  const price = quote?.regularMarketPrice;
  const date  = quote?.regularMarketTime
    ? new Date(quote.regularMarketTime * 1000).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  if (!price || price <= 0) {
    throw new Error(`Yahoo Finance: sin precio para ${ticker}`);
  }

  return { price, date, currency: 'USD' };
}
