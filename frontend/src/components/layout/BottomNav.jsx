import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Layers, TrendingUp, LineChart, ArrowLeftRight } from 'lucide-react';

const NAV = [
  { to: '/resumen',      label: 'Resumen',      Icon: LayoutDashboard },
  { to: '/posiciones',   label: 'Posiciones',   Icon: Layers          },
  { to: '/movimientos',  label: 'Movs',         Icon: ArrowLeftRight  },
  { to: '/rentabilidad', label: 'Rentab.',      Icon: TrendingUp      },
  { to: '/mercado',      label: 'Mercado',       Icon: LineChart       },
];

export default function BottomNav() {
  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-bg-card border-t border-bg-border">
      <div className="flex">
        {NAV.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center gap-1 py-3 text-[10px] transition-colors ${
                isActive ? 'text-accent' : 'text-muted'
              }`
            }>
            {({ isActive }) => (
              <>
                <Icon size={18} className={isActive ? 'text-accent' : 'text-muted'} />
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
