import { Eye, EyeOff } from 'lucide-react';
import { usePrivacy } from '../hooks/usePrivacy.js';
import { toggleHidden } from '../utils/privacy.js';

/**
 * Interruptor del modo privado.
 *   variant="sidebar"  -> fila en el pie del Sidebar (desktop)
 *   variant="floating" -> botón flotante (mobile; la BottomNav ya tiene 5 ítems)
 */
export default function PrivacyToggle({ variant = 'sidebar' }) {
  const hidden = usePrivacy();
  const Icon   = hidden ? EyeOff : Eye;
  const label  = hidden ? 'Mostrar montos' : 'Ocultar montos';

  if (variant === 'floating') {
    return (
      <button
        onClick={toggleHidden}
        aria-label={label}
        aria-pressed={hidden}
        title={label}
        className={`lg:hidden fixed bottom-24 left-4 z-40 w-10 h-10 rounded-full border shadow-lg
                    flex items-center justify-center backdrop-blur transition-colors ${
          hidden
            ? 'bg-accent/20 border-accent/40 text-accent'
            : 'bg-bg-card/95 border-bg-border text-muted hover:text-gray-200'
        }`}>
        <Icon size={16} />
      </button>
    );
  }

  return (
    <button
      onClick={toggleHidden}
      aria-pressed={hidden}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
        hidden ? 'text-accent bg-accent/10' : 'text-muted hover:bg-bg-hover hover:text-gray-200'
      }`}>
      <Icon size={15} />
      {label}
    </button>
  );
}
