import { NavLink } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.jsx';
import {
  LayoutDashboard,
  Layers,
  TrendingUp,
  LineChart,
  ArrowLeftRight,
  LogOut,
} from 'lucide-react';

const NAV = [
  { to: '/resumen',      label: 'Resumen',      Icon: LayoutDashboard },
  { to: '/posiciones',   label: 'Posiciones',   Icon: Layers          },
  { to: '/movimientos',  label: 'Movimientos',  Icon: ArrowLeftRight  },
  { to: '/rentabilidad', label: 'Rentabilidad', Icon: TrendingUp      },
  { to: '/mercado',      label: 'Mercado',       Icon: LineChart       },
];

export default function Sidebar() {
  const { user, signOut } = useAuth();

  return (
    <aside className="w-56 shrink-0 bg-bg-card border-r border-bg-border flex flex-col h-full">

      {/* Logo */}
      <div className="px-5 pt-6 pb-4 border-b border-bg-border">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-accent/20 flex items-center justify-center shrink-0">
            <TrendingUp size={15} className="text-accent" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">Portfolio</div>
            <div className="text-[10px] text-muted leading-tight">Tracker</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors group ${
                isActive
                  ? 'bg-accent/15 text-accent font-medium'
                  : 'text-muted hover:bg-bg-hover hover:text-gray-200'
              }`
            }>
            {({ isActive }) => (
              <>
                <Icon size={16} className={isActive ? 'text-accent' : 'text-muted group-hover:text-gray-300'} />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Usuario */}
      <div className="px-3 py-4 border-t border-bg-border space-y-1">
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg">
          <div className="w-6 h-6 rounded-full bg-bg-hover flex items-center justify-center shrink-0">
            <span className="text-[10px] text-muted font-medium uppercase">
              {user?.email?.[0]}
            </span>
          </div>
          <span className="text-xs text-muted truncate">{user?.email}</span>
        </div>
        <button onClick={signOut}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted hover:bg-bg-hover hover:text-loss transition-colors">
          <LogOut size={15} />
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
