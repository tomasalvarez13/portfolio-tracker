// Acciones chilenas (Bolsa de Santiago) via Yahoo Finance (yahoo-finance2).
// Tickers con sufijo .SN  ej: SALFACORP.SN, COLBUN.SN, CFMLVENFR.SN
// Validado: los 5 tickers de Renta 4 responden con precios correctos.

import YahooFinance from 'yahoo-finance2';

// Instancia singleton — requerida por v3
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

/**
 * Precio actual de una acción chilena.
 * @param {string} ticker - sin sufijo, ej: 'SALFACORP' (se agrega .SN)
 * @returns {Promise<{price: number, date: string, currency: string}>}
 */
export async function fetchStockCl(ticker) {
  const symbol = ticker.toUpperCase().endsWith('.SN') ? ticker : `${ticker}.SN`;
  const quote = await yf.quote(symbol, {}, { validateResult: false });

  const price = quote?.regularMarketPrice;
  const date  = quote?.regularMarketTime
    ? new Date(quote.regularMarketTime * 1000).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  if (!price || price <= 0) {
    throw new Error(`Yahoo Finance: sin precio para ${symbol}`);
  }

  return { price, date, currency: 'CLP' };
}
