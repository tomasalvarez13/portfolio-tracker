import { useEffect } from 'react';
import { enableDemo } from '../demo/mode.js';

// Punto de entrada del modo demo: prende el flag y entra a la app normal.
//
// La navegación es una recarga completa a propósito. AuthProvider lee el flag al
// montar y no consume el contexto del router, así que si entráramos con <Navigate>
// desde un <Link> de la landing seguiría con la sesión vieja (null) y
// ProtectedRoute nos rebotaría a la portada. Con replace() el flag ya está puesto
// cuando el árbol se vuelve a montar, y además el back no vuelve a /demo.
export default function Demo() {
  useEffect(() => {
    enableDemo();
    window.location.replace('/app/resumen');
  }, []);

  return <div className="h-screen grid place-items-center text-muted">Cargando demo…</div>;
}
