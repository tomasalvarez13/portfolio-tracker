import { useLocation } from 'react-router-dom';
import { isDemo, disableDemo } from '../demo/mode.js';

// Distintivo flotante mientras el modo demo está activo, con la salida a mano.
export default function DemoBadge() {
  // App no consume el contexto del router, así que no se re-renderiza al navegar.
  // Al entrar por /demo el flag se prende recién después del primer render, y sin
  // esto el badge se quedaría pegado en null hasta recargar.
  useLocation();

  if (!isDemo()) return null;

  return (
    <div className="fixed bottom-24 lg:bottom-4 right-4 z-50 flex items-center gap-2 rounded-full
                    border border-accent/40 bg-bg-card/95 backdrop-blur px-3 py-1.5 text-xs shadow-lg">
      <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
      <span className="text-muted">Modo demo · datos de ejemplo</span>
      <button
        onClick={() => { disableDemo(); window.location.assign('/'); }}
        className="text-accent hover:underline font-medium">
        Salir
      </button>
    </div>
  );
}
