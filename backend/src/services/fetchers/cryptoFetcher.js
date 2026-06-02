// Bitcoin (y otras cryptos) via CoinGecko.
// GET .../simple/price?ids=bitcoin&vs_currencies=usd,clp
// Validado: $73,808 USD / $65.6M CLP.

const BASE = 'https://api.coingecko.com/api/v3/simple/price';

/**
 * Precio actual de una crypto en USD y CLP.
 * @param {string} coingeckoId - ej: 'bitcoin'
 * @returns {Promise<{price_usd: number, price_clp: number}>}
 */
export async function fetchCrypto(coingeckoId = 'bitcoin') {
  const url = `${BASE}?ids=${encodeURIComponent(coingeckoId)}&vs_currencies=usd,clp`;
  const res = await fetch(url, { headers: { 'User-Agent': 'portfolio-tracker' } });
  if (!res.ok) throw new Error(`CoinGecko respondió ${res.status}`);
  const data = await res.json();

  const entry = data?.[coingeckoId];
  if (!entry || !Number.isFinite(entry.usd)) {
    throw new Error(`CoinGecko: sin datos para ${coingeckoId}`);
  }

  return {
    price_usd: Number(entry.usd),
    price_clp: Number.isFinite(entry.clp) ? Number(entry.clp) : null,
  };
}
