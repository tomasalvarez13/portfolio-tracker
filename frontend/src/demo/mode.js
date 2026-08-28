// Modo demo: la app real corriendo contra datos sintéticos, sin login ni backend.
//
// Se activa entrando a /demo y vive en sessionStorage, así que muere al cerrar la
// pestaña y nunca se mezcla con una sesión real en otra. Ningún dato de acá sale
// ni entra a Supabase: el adapter de axios corta las requests antes de la red.

const FLAG = 'demo_mode_v1';

export const DEMO_USER = {
  id:    'demo-user-0000-0000-000000000000',
  email: 'demo@portfolio.app',
};

export function isDemo() {
  try { return sessionStorage.getItem(FLAG) === '1'; } catch { return false; }
}

export function enableDemo() {
  try {
    sessionStorage.setItem(FLAG, '1');
    // El demo entra directo al dashboard: sin onboarding ni tutorial de por medio.
    localStorage.setItem(`onboarding_v1_${DEMO_USER.id}`, 'done');
    localStorage.setItem(`tutorial_dismissed_${DEMO_USER.id}`, 'true');
  } catch { /* storage bloqueado: el demo igual funciona en memoria */ }
}

export function disableDemo() {
  try {
    sessionStorage.removeItem(FLAG);
    // Borrar el cache de usePersistedFetch para no dejar datos del demo dando vueltas.
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('demo:') || k.includes(DEMO_USER.id)) localStorage.removeItem(k);
    }
  } catch { /* idem */ }
}
