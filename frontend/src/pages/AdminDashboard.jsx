import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAdminUsers, getAdminStats } from '../services/api';
import { formatDate } from '../utils/formatters';
import { LogOut, Users, Activity, TrendingUp, Layers } from 'lucide-react';

function StatCard({ label, value, Icon, color = 'text-accent' }) {
  return (
    <div className="card p-4 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-xl bg-bg-hover flex items-center justify-center shrink-0`}>
        <Icon size={16} className={color} />
      </div>
      <div>
        <div className="text-xl font-semibold num">{value}</div>
        <div className="text-xs text-muted">{label}</div>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const [stats, setStats]   = useState(null);
  const [users, setUsers]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const navigate            = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) { navigate('/admin/login'); return; }
    Promise.all([getAdminStats(), getAdminUsers()])
      .then(([s, u]) => { setStats(s); setUsers(u.users); })
      .catch(() => { localStorage.removeItem('admin_token'); navigate('/admin/login'); })
      .finally(() => setLoading(false));
  }, [navigate]);

  function handleLogout() {
    localStorage.removeItem('admin_token');
    navigate('/admin/login');
  }

  const filtered = users.filter(u =>
    !search || u.email?.toLowerCase().includes(search.toLowerCase())
  );

  const daysSince = (iso) => {
    if (!iso) return '—';
    const d = Math.floor((Date.now() - new Date(iso)) / 86_400_000);
    if (d === 0) return 'Hoy';
    if (d === 1) return 'Ayer';
    return `Hace ${d} días`;
  };

  if (loading) return (
    <div className="min-h-screen grid place-items-center">
      <div className="text-muted text-sm">Cargando…</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-bg-base">
      {/* Header */}
      <header className="border-b border-bg-border bg-bg-card px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="font-semibold">Panel de administración</h1>
          <p className="text-xs text-muted">Portfolio Tracker</p>
        </div>
        <button onClick={handleLogout}
          className="flex items-center gap-2 text-xs text-muted hover:text-loss px-3 py-2 rounded-lg hover:bg-bg-hover transition-colors">
          <LogOut size={14} /> Salir
        </button>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Usuarios totales"     value={stats?.total_users ?? '—'}         Icon={Users}      />
          <StatCard label="Activos últimos 30d"  value={stats?.active_users_30d ?? '—'}    Icon={Activity}   color="text-gain" />
          <StatCard label="Con posiciones"        value={stats?.users_with_positions ?? '—'} Icon={Layers}    color="text-accent" />
          <StatCard label="Movimientos totales"  value={stats?.total_movements ?? '—'}     Icon={TrendingUp} color="text-muted" />
        </div>

        {/* Tabla de usuarios */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-bg-border flex items-center justify-between gap-3 flex-wrap">
            <h2 className="font-medium text-sm">Usuarios ({filtered.length})</h2>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por email…"
              className="bg-bg-base border border-bg-border rounded-lg px-3 py-1.5 text-xs w-48 focus:outline-none focus:border-accent" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-bg-border">
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Registrado</th>
                  <th className="px-4 py-3 font-medium">Último acceso</th>
                  <th className="px-4 py-3 font-medium text-right">Posiciones</th>
                  <th className="px-4 py-3 font-medium text-right">Movimientos</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => (
                  <tr key={u.id} className="border-b border-bg-border/50 hover:bg-bg-hover/30">
                    <td className="px-4 py-3 font-medium">{u.email}</td>
                    <td className="px-4 py-3 text-xs text-muted">{formatDate(u.created_at)}</td>
                    <td className="px-4 py-3 text-xs text-muted">{daysSince(u.last_sign_in_at)}</td>
                    <td className="px-4 py-3 text-right num">{u.positions_count}</td>
                    <td className="px-4 py-3 text-right num">{u.movements_count}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                        u.confirmed ? 'bg-gain/15 text-gain' : 'bg-muted/15 text-muted'
                      }`}>
                        {u.confirmed ? 'Confirmado' : 'Pendiente'}
                      </span>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">Sin usuarios.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
