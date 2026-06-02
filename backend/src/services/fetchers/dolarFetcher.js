// Dólar observado del Banco Central via mindicador.cl
// GET https://mindicador.cl/api/dolar  -> { serie: [{ fecha, valor }, ...] }
// Validado: $892.89 CLP/USD al 29-may-2026.

const URL = 'https://mindicador.cl/api/dolar';

/**
 * Devuelve el dólar observado más reciente.
 * @returns {Promise<{date: string, usd_clp: number}>}
 */
export async function fetchDolar() {
  const res = await fetch(URL, { headers: { 'User-Agent': 'portfolio-tracker' } });
  if (!res.ok) throw new Error(`mindicador.cl respondió ${res.status}`);
  const data = await res.json();

  const serie = data?.serie;
  if (!Array.isArray(serie) || serie.length === 0) {
    throw new Error('mindicador.cl: serie de dólar vacía');
  }

  // El primer elemento es el más reciente.
  const latest = serie[0];
  const date = latest.fecha?.slice(0, 10); // YYYY-MM-DD
  const usd_clp = Number(latest.valor);

  if (!date || !Number.isFinite(usd_clp)) {
    throw new Error('mindicador.cl: dato de dólar inválido');
  }

  return { date, usd_clp };
}
