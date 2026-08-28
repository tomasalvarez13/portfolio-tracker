// Adapter de axios para el modo demo: intercepta la request antes de que salga a
// la red y la responde desde el dataset sintético, con la misma forma que devuelve
// axios (incluidos los errores, para que `e.response.data.error` siga funcionando).

import { handle } from './server.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function demoAdapter(config) {
  // Latencia falsa: mantiene visibles los "Actualizando…" de usePersistedFetch.
  await sleep(120 + Math.random() * 180);

  let body = config.data;
  if (typeof FormData !== 'undefined' && body instanceof FormData) body = {};
  else if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  else if (body == null) body = {};

  const { status, data } = handle({
    method: config.method || 'get',
    path:   config.url || '/',
    params: config.params || {},
    body,
  });

  const response = {
    data, status,
    statusText: status === 204 ? 'No Content' : 'OK',
    headers: {}, config, request: {},
  };

  if (status >= 400) {
    const err = new Error(data?.error || `Request failed with status code ${status}`);
    err.isAxiosError = true;
    err.config = config;
    err.response = response;
    throw err;
  }
  return response;
}
