// Modo privado: oculta los montos visibles sin cambiar nada de los datos.
//
// El estado vive fuera de React a propósito. Los formatters (formatCLP, etc.)
// son funciones puras usadas en 71 lugares, y no pueden leer un contexto; con
// una variable de módulo se enmascara todo sin tocar un solo punto de llamada.
// El re-render lo dispara usePrivacy() en el Layout, que sí es un hook.

let hidden     = false;
let storageKey = null;
const listeners = new Set();

const emit = () => { for (const fn of listeners) fn(); };

/** Carga la preferencia del usuario. La llama el Layout cuando hay sesión. */
export function initPrivacy(userId) {
  const key = userId ? `privacy_hidden_${userId}` : null;
  if (key === storageKey) return;
  storageKey = key;

  let next = false;
  try { next = key ? localStorage.getItem(key) === '1' : false; } catch { /* storage bloqueado */ }
  if (next !== hidden) { hidden = next; emit(); }
}

export const isHidden = () => hidden;

export function setHidden(value) {
  hidden = !!value;
  try { if (storageKey) localStorage.setItem(storageKey, hidden ? '1' : '0'); } catch { /* idem */ }
  emit();
}

export const toggleHidden = () => setHidden(!hidden);

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Reemplaza los dígitos y deja el resto intacto: $12.345.678 -> $••.•••.•••
 * Conserva símbolo y separadores, así que con `tabular-nums` no se mueve ninguna
 * columna. Y el valor real nunca llega al DOM, a diferencia de un blur por CSS.
 */
export const maskDigits = (text) => String(text).replace(/\d/g, '•');
