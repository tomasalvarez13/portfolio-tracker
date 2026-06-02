export function Spinner({ label = 'Cargando…' }) {
  return (
    <div className="flex items-center gap-3 text-muted py-10 justify-center">
      <span className="inline-block w-4 h-4 border-2 border-muted border-t-transparent rounded-full animate-spin" />
      {label}
    </div>
  );
}

export function ErrorBox({ message }) {
  return (
    <div className="card p-4 border-loss/40 text-loss text-sm">
      {message || 'Ocurrió un error'}
    </div>
  );
}
