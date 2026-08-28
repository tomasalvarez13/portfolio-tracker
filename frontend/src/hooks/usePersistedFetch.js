import { useState, useEffect, useCallback, useRef } from 'react';
import { isDemo } from '../demo/mode.js';

// Stale-while-revalidate: muestra datos cacheados inmediatamente y refresca en background.
// loading=true solo cuando no hay cache y estamos cargando por primera vez.
// syncing=true cuando hay cache pero estamos refrescando en background.
export function usePersistedFetch(key, fetchFn) {
  // En demo se prefija la clave: la mayoría lleva el user id, pero 'mercado_v1' es
  // global y sin esto el demo mostraría el cache de la cuenta real por un instante.
  const cacheKey = key && isDemo() ? `demo:${key}` : key;

  const fnRef = useRef(fetchFn);
  fnRef.current = fetchFn;

  const [data, setData] = useState(() => {
    if (!cacheKey) return null;
    try { return JSON.parse(localStorage.getItem(cacheKey)); } catch { return null; }
  });
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    if (!cacheKey) return;
    setSyncing(true);
    setError(null);
    try {
      const result = await fnRef.current();
      setData(result);
      try { localStorage.setItem(cacheKey, JSON.stringify(result)); } catch {}
    } catch (e) {
      setError(e);
    } finally {
      setSyncing(false);
    }
  }, [cacheKey]);

  useEffect(() => { reload(); }, [reload]);

  return { data, loading: data == null && syncing, syncing, error, reload };
}
