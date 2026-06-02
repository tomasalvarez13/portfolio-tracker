// Acciones / ETFs (USA y .SN chilenas) via Alpha Vantage GLOBAL_QUOTE.
// Validado: 9 tickers USA con calce 100% contra certificado.
//
// Plan gratuito: 25 requests/día, ~5/min. El orquestador serializa con pausas.

const BASE = 'https://www.alphavantage.co/query';

/**
 * Cotización actual de un ticker.
 * @param {string} ticker - ej: 'AAPL', 'FALABELLA.SN'
 * @returns {Promise<{price: number, date: string, currency: string}>}
 */
export async function fetchStockQuote(ticker) {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) throw new Error('Falta ALPHA_VANTAGE_API_KEY');

  const url = `${BASE}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'portfolio-tracker' } });
  if (!res.ok) throw new Error(`Alpha Vantage respondió ${res.status} para ${ticker}`);
  const data = await res.json();

  // Rate limit / nota informativa
  if (data?.Note || data?.Information) {
    throw new Error(`Alpha Vantage límite/info para ${ticker}: ${data.Note || data.Information}`);
  }

  const q = data?.['Global Quote'];
  const price = Number(q?.['05. price']);
  const date = q?.['07. latest trading day'];

  if (!q || !Number.isFinite(price) || price === 0 || !date) {
    throw new Error(`Alpha Vantage: sin cotización válida para ${ticker}`);
  }

  // .SN = Bolsa de Santiago (CLP), resto asumimos USD.
  const currency = ticker.toUpperCase().endsWith('.SN') ? 'CLP' : 'USD';
  return { price, date, currency };
}
