// Fechas del sistema, siempre en hora de Chile.
//
// El bug que esto arregla: `new Date().toISOString().slice(0,10)` devuelve la
// fecha en UTC, mientras el cron corre en America/Santiago. Chile está en
// UTC-3/-4, así que entre las 20:00 y la medianoche local ya es el día
// siguiente en UTC. Un /api/prices/refresh disparado a las 21:30 CLT escribía
// el precio con fecha de mañana, y el snapshot del día quedaba en el futuro.

const TZ = 'America/Santiago';

// en-CA da directamente YYYY-MM-DD.
const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

/** Fecha de hoy en Chile, 'YYYY-MM-DD'. */
export function todayCL() {
  return fmt.format(new Date());
}

/** Convierte un Date (o lo que devuelve pg para DATE) a 'YYYY-MM-DD' en Chile. */
export function toCLDate(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  return fmt.format(d);
}

/**
 * Normaliza una columna DATE de pg a 'YYYY-MM-DD'.
 *
 * A diferencia de toCLDate, usa los componentes locales sin convertir de zona:
 * pg devuelve las DATE como un Date a medianoche local, y pasarlo por un
 * formateador con timezone puede correrlo un día. Para columnas DATE esto es lo
 * correcto; para TIMESTAMPTZ usar toCLDate.
 */
export function toISODate(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Suma (o resta) días a una fecha 'YYYY-MM-DD'. Devuelve 'YYYY-MM-DD'. */
export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  // Date.UTC evita que un cambio de horario corra el resultado un día.
  const t = Date.UTC(y, m - 1, d) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/** true si la fecha 'YYYY-MM-DD' cae sábado o domingo. */
export function isWeekend(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 || dow === 6;
}
