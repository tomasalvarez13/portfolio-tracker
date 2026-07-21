// Bitcoin (y otras cryptos) via CoinGecko.
// GET .../simple/price?ids=bitcoin&vs_currencies=usd,clp
// Validado: $73,808 USD / $65.6M CLP.
//
// El endpoint público (sin API key) rate-limitea con 429 seguido. Reintentamos
// con backoff exponencial antes de darlo por caído.

const BASE = 'https://api.coingecko.com/api/v3/simple/price';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url, { retries = 3, baseDelayMs = 1000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'portfolio-tracker' } });
    if (res.ok) return res;

    const retriable = res.status === 429 || res.status >= 500;
    if (!retriable || attempt >= retries) {
      throw new Error(`CoinGecko respondió ${res.status}`);
    }

    const retryAfter = Number(res.headers.get('retry-after'));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : baseDelayMs * 2 ** attempt;
    await sleep(delay);
  }
}

/**
 * Precio actual de una crypto en USD y CLP.
 * @param {string} coingeckoId - ej: 'bitcoin'
 * @returns {Promise<{price_usd: number, price_clp: number}>}
 */
export async function fetchCrypto(coingeckoId = 'bitcoin') {
  const url = `${BASE}?ids=${encodeURIComponent(coingeckoId)}&vs_currencies=usd,clp`;
  const res = await fetchWithRetry(url);
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
