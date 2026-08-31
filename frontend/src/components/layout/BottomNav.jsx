import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Layers, TrendingUp, ArrowLeftRight, PieChart, MessageSquare } from 'lucide-react';

// Seis entradas con etiquetas cortas. Sacar Chat para hacerle lugar a Análisis
// lo habría dejado inaccesible en móvil: el sidebar es solo desktop.
const NAV = [
  { to: '/app/resumen',      label: 'Resumen',  Icon: LayoutDashboard },
  { to: '/app/posiciones',   label: 'Posic.',   Icon: Layers          },
  { to: '/app/movimientos',  label: 'Movs',     Icon: ArrowLeftRight  },
  { to: '/app/rentabilidad', label: 'Rentab.',  Icon: TrendingUp      },
  { to: '/app/analisis',     label: 'Análisis', Icon: PieChart        },
  { to: '/app/chat',         label: 'Chat',     Icon: MessageSquare   },
];

export default function BottomNav() {
  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-bg-card border-t border-bg-border">
      <div className="flex">
        {NAV.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to}
            className={({ isActive }) =>
              `flex-1 min-w-0 flex flex-col items-center justify-center gap-1 px-0.5 py-3 text-[10px] transition-colors ${
                isActive ? 'text-accent' : 'text-muted'
              }`
            }>
            {({ isActive }) => (
              <>
                <Icon size={18} className={isActive ? 'text-accent' : 'text-muted'} />
                <span className="truncate max-w-full">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
