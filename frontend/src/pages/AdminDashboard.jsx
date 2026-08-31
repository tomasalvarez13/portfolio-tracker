import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  getAdminUsers, getAdminStats, deleteAdminUser,
  getInvitations, createInvitation, deleteInvitation,
  getInviteRequests, approveInviteRequest, rejectInviteRequest,
  getPendingInstruments,
} from '../services/api';
import { formatDate } from '../utils/formatters';
import { InstrumentsPanel, CustodiansPanel } from '../components/admin/MaestroPanel.jsx';
import CronPanel from '../components/admin/CronPanel.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { isDemo } from '../demo/mode.js';
import { LogOut, Users, Activity, TrendingUp, Layers, MailPlus, Trash2, Check, X, Inbox, Package, Building2, Timer } from 'lucide-react';

function StatCard({ label, value, Icon, color = 'text-accent' }) {
  return (
    <div className="card p-4 flex items-center gap-3">
      <div className="w-9 h-9 rounded-xl bg-bg-hover flex items-center justify-center shrink-0">
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
  const { session, loading: authLoading, signOut } = useAuth();
  const [stats, setStats]       = useState(null);
  const [users, setUsers]       = useState([]);
  const [invites, setInvites]   = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [denied, setDenied]     = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch]     = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newNote, setNewNote]   = useState('');
  const [inviteErr, setInviteErr] = useState(null);
  const [inviting, setInviting] = useState(false);
  // Solo para el contador de la pestaña: el mantenedor vive en MaestroPanel.
  const [pending, setPending] = useState([]);
  // Las secciones de mantenedor son pesadas: se montan solo al entrar a su
  // pestaña, así el panel de usuarios no arrastra sus queries.
  const [tab, setTab] = useState('usuarios');
  const navigate = useNavigate();

  // El adapter del demo intercepta toda la API, así que acá no habría datos que
  // mostrar: el panel es de la cuenta real o de nadie.
  const demo = isDemo();

  async function loadData() {
    setLoading(true); setLoadError(null); setDenied(false);
    try {
      const [s, u, i, r, pi] = await Promise.all([
        getAdminStats(), getAdminUsers(), getInvitations(), getInviteRequests(),
        // Endpoint nuevo: si el backend todavía no está desplegado, el resto del
        // panel tiene que seguir cargando.
        getPendingInstruments().catch(() => ({ instruments: [] })),
      ]);
      setStats(s); setUsers(u.users); setInvites(i.invitations); setRequests(r.requests);
      setPending(pi.instruments || []);
    } catch (e) {
      const status = e.response?.status;
      // 401: sesión vencida → al login. 403: sesión válida sin rol admin.
      if (status === 401) navigate('/admin/login');
      else if (status === 403) setDenied(true);
      else setLoadError(e.response?.data?.error || e.message || 'Error al conectar con el servidor');
    } finally { setLoading(false); }
  }

  useEffect(() => {
    if (demo || authLoading) return;
    if (!session) { navigate('/admin/login'); return; }
    loadData();
  }, [demo, authLoading, session]);

  async function handleDelete(id) {
    setDeleting(true);
    try {
      await deleteAdminUser(id);
      setConfirmDelete(null);
      await loadData();
    } catch (e) {
      alert(e.response?.data?.error || e.message);
    } finally { setDeleting(false); }
  }

  async function handleInvite(e) {
    e.preventDefault();
    setInviteErr(null); setInviting(true);
    try {
      await createInvitation({ email: newEmail.trim(), note: newNote.trim() || null });
      setNewEmail(''); setNewNote('');
      await loadData();
    } catch (e) {
      setInviteErr(e.response?.data?.error || e.message);
    } finally { setInviting(false); }
  }

  async function handleResolve(id, action) {
    try {
      await (action === 'approve' ? approveInviteRequest(id) : rejectInviteRequest(id));
      await loadData();
    } catch (e) { alert(e.response?.data?.error || e.message); }
  }

  async function handleRevoke(id) {
    try { await deleteInvitation(id); await loadData(); }
    catch (e) { alert(e.response?.data?.error || e.message); }
  }

  const filtered = users.filter(u => !search || u.email?.toLowerCase().includes(search.toLowerCase()));
  const pendingCount = requests.filter(r => r.status === 'pending').length;

  const daysSince = (iso) => {
    if (!iso) return '—';
    const d = Math.floor((Date.now() - new Date(iso)) / 86_400_000);
    if (d === 0) return 'Hoy';
    if (d === 1) return 'Ayer';
    return `Hace ${d} días`;
  };

  if (demo) return <Navigate to="/app/resumen" replace />;

  if (authLoading || loading) return (
    <div className="min-h-screen grid place-items-center">
      <div className="text-center space-y-2">
        <div className="text-muted text-sm">Conectando con el servidor…</div>
        <div className="text-xs text-muted/60">(El backend puede tardar ~30s en despertar)</div>
      </div>
    </div>
  );

  if (denied) return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="text-center space-y-4 max-w-sm">
        <div className="text-2xl">🔒</div>
        <div className="text-sm font-medium">Tu cuenta no tiene permisos de administrador</div>
        <p className="text-xs text-muted">
          Pedí que te asignen el rol <code className="text-accent">admin</code> en la tabla <code>users</code>.
        </p>
        <button onClick={async () => { await signOut(); navigate('/admin/login'); }}
          className="text-xs text-muted hover:text-gray-300">Cambiar de cuenta</button>
      </div>
    </div>
  );

  if (loadError) return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="text-center space-y-4 max-w-sm">
        <div className="text-2xl">⚠️</div>
        <div className="text-sm font-medium">Error al cargar el panel</div>
        <div className="text-xs text-muted bg-bg-card border border-bg-border rounded-lg px-4 py-3 text-left break-all">
          {loadError}
        </div>
        <button onClick={loadData}
          className="px-5 py-2 bg-accent hover:bg-accent/90 text-white rounded-lg text-sm font-medium">
          Reintentar
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-bg-base">
      <header className="border-b border-bg-border bg-bg-card px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="font-semibold">Panel de administración</h1>
          <p className="text-xs text-muted">{session?.user?.email}</p>
        </div>
        <button onClick={async () => { await signOut(); navigate('/admin/login'); }}
          className="flex items-center gap-2 text-xs text-muted hover:text-loss px-3 py-2 rounded-lg hover:bg-bg-hover transition-colors">
          <LogOut size={14} /> Salir
        </button>
      </header>

      {/* Pestañas del panel */}
      <div className="max-w-5xl mx-auto px-4 pt-6">
      <div className="flex gap-1 p-1 rounded-xl bg-bg-card border border-bg-border w-fit mb-6 flex-wrap">
        {[
          { key: 'usuarios',     label: 'Usuarios e invitaciones', icon: Users },
          { key: 'instrumentos', label: 'Instrumentos',            icon: Package, badge: pending.length },
          { key: 'custodios',    label: 'Custodios',               icon: Building2 },
          { key: 'cron',         label: 'Cron',                    icon: Timer },
        ].map(({ key, label, icon: Icon, badge }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs transition-colors ${
              tab === key ? 'bg-accent/15 text-accent font-medium' : 'text-muted hover:text-gray-200'
            }`}>
            <Icon size={13} /> {label}
            {badge > 0 && (
              <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-accent/20 text-accent text-[10px]">
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>
      </div>

      {tab === 'usuarios' && (
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Usuarios totales"    value={stats?.total_users ?? '—'}           Icon={Users} />
          <StatCard label="Activos últimos 30d" value={stats?.active_users_30d ?? '—'}      Icon={Activity}   color="text-gain" />
          <StatCard label="Con posiciones"      value={stats?.users_with_positions ?? '—'}  Icon={Layers}     color="text-accent" />
          <StatCard label="Movimientos totales" value={stats?.total_movements ?? '—'}       Icon={TrendingUp} color="text-muted" />
        </div>

        {/* Solicitudes de invitación */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-bg-border flex items-center gap-2">
            <Inbox size={14} className="text-muted" />
            <h2 className="font-medium text-sm">Solicitudes</h2>
            {pendingCount > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent/20 text-accent font-medium">
                {pendingCount} pendiente{pendingCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-bg-border">
                  <th className="px-4 py-3 font-medium">Correo</th>
                  <th className="px-4 py-3 font-medium">Nombre</th>
                  <th className="px-4 py-3 font-medium">Solicitado</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {requests.map(r => (
                  <tr key={r.id} className="border-b border-bg-border/50 hover:bg-bg-hover/30">
                    <td className="px-4 py-3 font-medium">{r.email}</td>
                    <td className="px-4 py-3 text-xs text-muted">{r.name || '—'}</td>
                    <td className="px-4 py-3 text-xs text-muted">{formatDate(r.created_at)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                        r.status === 'approved' ? 'bg-gain/15 text-gain'
                        : r.status === 'rejected' ? 'bg-loss/15 text-loss'
                        : 'bg-accent/15 text-accent'
                      }`}>
                        {r.status === 'approved' ? 'Aprobada' : r.status === 'rejected' ? 'Rechazada' : 'Pendiente'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {r.status === 'pending' ? (
                        <span className="inline-flex items-center gap-3">
                          <button onClick={() => handleResolve(r.id, 'approve')}
                            className="inline-flex items-center gap-1 text-xs text-gain hover:underline font-medium">
                            <Check size={12} /> Aprobar
                          </button>
                          <button onClick={() => handleResolve(r.id, 'reject')}
                            className="inline-flex items-center gap-1 text-xs text-muted hover:text-loss">
                            <X size={12} /> Rechazar
                          </button>
                        </span>
                      ) : (
                        <span className="text-xs text-muted">{formatDate(r.resolved_at)}</span>
                      )}
                    </td>
                  </tr>
                ))}
                {requests.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted text-xs">
                    Sin solicitudes.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          {requests.some(r => r.status === 'approved') && (
            <p className="px-4 py-2.5 border-t border-bg-border text-[11px] text-muted">
              Aprobar crea la invitación, pero no manda ningún correo: avisale vos que ya puede registrarse.
            </p>
          )}
        </div>

        {/* Invitaciones */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-bg-border">
            <h2 className="font-medium text-sm">Invitaciones ({invites.length})</h2>
            <p className="text-xs text-muted mt-0.5">
              Solo estos correos pueden registrarse. Lo valida Supabase antes de crear la cuenta.
            </p>
          </div>

          <form onSubmit={handleInvite} className="px-4 py-3 border-b border-bg-border flex gap-2 flex-wrap items-start">
            <input type="email" required value={newEmail} onChange={e => setNewEmail(e.target.value)}
              placeholder="correo@ejemplo.com"
              className="flex-1 min-w-[200px] bg-bg-base border border-bg-border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-accent" />
            <input value={newNote} onChange={e => setNewNote(e.target.value)}
              placeholder="Nota (opcional)"
              className="flex-1 min-w-[140px] bg-bg-base border border-bg-border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-accent" />
            <button type="submit" disabled={inviting}
              className="flex items-center gap-1.5 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white rounded-lg px-3 py-1.5 text-xs font-medium">
              <MailPlus size={13} /> {inviting ? 'Invitando…' : 'Invitar'}
            </button>
            {inviteErr && <p className="w-full text-xs text-loss">{inviteErr}</p>}
          </form>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-bg-border">
                  <th className="px-4 py-3 font-medium">Correo</th>
                  <th className="px-4 py-3 font-medium">Nota</th>
                  <th className="px-4 py-3 font-medium">Invitado</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {invites.map(i => (
                  <tr key={i.id} className="border-b border-bg-border/50 hover:bg-bg-hover/30">
                    <td className="px-4 py-3 font-medium">{i.email}</td>
                    <td className="px-4 py-3 text-xs text-muted">{i.note || '—'}</td>
                    <td className="px-4 py-3 text-xs text-muted">{formatDate(i.created_at)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                        i.used_at ? 'bg-gain/15 text-gain' : 'bg-muted/15 text-muted'
                      }`}>
                        {i.used_at ? 'Registrado' : 'Pendiente'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => handleRevoke(i.id)} title="Revocar invitación"
                        className="text-muted hover:text-loss transition-colors">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
                {invites.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">
                    Sin invitaciones. Nadie puede registrarse todavía.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Usuarios */}
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
                  <th className="px-4 py-3 font-medium text-right">Acciones</th>
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
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {confirmDelete === u.id ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="text-xs text-muted">¿Eliminar?</span>
                          <button onClick={() => handleDelete(u.id)} disabled={deleting}
                            className="text-xs text-loss font-medium hover:underline disabled:opacity-50">
                            {deleting ? '…' : 'Sí'}
                          </button>
                          <button onClick={() => setConfirmDelete(null)}
                            className="text-xs text-muted hover:text-gray-200">No</button>
                        </span>
                      ) : (
                        <button onClick={() => setConfirmDelete(u.id)}
                          className="text-xs text-muted hover:text-loss transition-colors">
                          eliminar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-muted">Sin usuarios.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      )}

      {tab !== 'usuarios' && (
        <div className="max-w-5xl mx-auto px-4 py-6">
          {tab === 'instrumentos' && <InstrumentsPanel />}
          {tab === 'custodios'    && <CustodiansPanel />}
          {tab === 'cron'         && <CronPanel />}
        </div>
      )}
    </div>
  );
}