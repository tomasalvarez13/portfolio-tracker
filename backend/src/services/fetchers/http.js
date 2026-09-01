// Salida HTTP con timeout, para todos los fetchers.
//
// Ninguno tenía uno. undici no impone un límite total de respuesta, así que una
// fuente colgada bloqueaba el `Promise.all` de runBatch —que espera a que cierren
// todos los jobs del lote antes de responder— y el curl de GitHub Actions moría
// con exit 28, dejando la corrida a medias.
//
// Con timeout, un cuelgue pasa a ser un job `failed` con backoff, que es un
// estado que la cola ya sabe reintentar sola.

const DEFAULT_TIMEOUT_MS = 15_000;

const hostDe = (url) => { try { return new URL(url).host; } catch { return String(url).slice(0, 40); } };

/**
 * `fetch` con AbortSignal.timeout y User-Agent por defecto.
 *
 * El timeout cubre la respuesta completa, no solo los headers. Al vencer lanza
 * un Error normal —no un DOMException— para que el mensaje llegue legible a
 * `last_error` en price_fetch_jobs.
 */
export async function fetchConTimeout(url, { timeoutMs = DEFAULT_TIMEOUT_MS, headers, ...rest } = {}) {
  try {
    return await fetch(url, {
      ...rest,
      headers: { 'User-Agent': 'portfolio-tracker', ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      throw new Error(`${hostDe(url)} no respondió en ${Math.round(timeoutMs / 1000)}s`);
    }
    throw e;
  }
}

/**
 * Presupuesto de tiempo para los fetchers que hacen varios requests por job.
 *
 * Un timeout por request no acota el total: el de la Superintendencia recorre
 * día por día y puede encadenar decenas de POST, y el de CoinGecko reintenta
 * respetando Retry-After. El presupuesto es el techo del job completo.
 */
export function presupuesto(ms) {
  const fin = Date.now() + ms;
  return {
    agotado: () => Date.now() >= fin,
    restanteMs: () => Math.max(0, fin - Date.now()),
  };
}
