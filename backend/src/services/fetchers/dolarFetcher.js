// Dólar observado del Banco Central via mindicador.cl
// GET https://mindicador.cl/api/dolar  -> { serie: [{ fecha, valor }, ...] }
// Validado: $892.89 CLP/USD al 29-may-2026.

import { fetchConTimeout } from './http.js';

const URL = 'https://mindicador.cl/api/dolar';

async function pedirSerie() {
  const res = await fetchConTimeout(URL);
  if (!res.ok) throw new Error(`mindicador.cl respondió ${res.status}`);
  const data = await res.json();

  const serie = data?.serie;
  if (!Array.isArray(serie) || serie.length === 0) {
    throw new Error('mindicador.cl: serie de dólar vacía');
  }
  return serie;
}

/**
 * Devuelve el dólar observado más reciente.
 * @returns {Promise<{date: string, usd_clp: number}>}
 */
export async function fetchDolar() {
  const serie = await pedirSerie();

  // El primer elemento es el más reciente.
  const latest = serie[0];
  const date = latest.fecha?.slice(0, 10); // YYYY-MM-DD
  const usd_clp = Number(latest.valor);

  if (!date || !Number.isFinite(usd_clp)) {
    throw new Error('mindicador.cl: dato de dólar inválido');
  }

  return { date, usd_clp };
}

/**
 * El dólar observado de cada día de un rango.
 *
 * Es el mismo request que fetchDolar —la respuesta ya trae la serie completa del
 * año— pero conservando todas las fechas. Sin esto, un precio histórico se
 * convertía CLP↔USD con el dólar de hoy.
 *
 * @param {string} since - 'YYYY-MM-DD'
 * @param {string} until - 'YYYY-MM-DD', inclusive
 * @returns {Promise<Array<{date: string, usd_clp: number}>>} ordenado por fecha
 */
export async function fetchSerieDolar(since, until) {
  const serie = await pedirSerie();

  const salida = [];
  for (const punto of serie) {
    const date = punto?.fecha?.slice(0, 10);
    const usd_clp = Number(punto?.valor);
    if (!date || !Number.isFinite(usd_clp)) continue;
    if (date < since || date > until) continue;
    salida.push({ date, usd_clp });
  }
  return salida.sort((a, b) => (a.date < b.date ? -1 : 1));
}
