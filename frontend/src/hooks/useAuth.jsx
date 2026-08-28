// Contexto de autenticación basado en Supabase Auth.
// En modo demo se sustituye por un usuario sintético y Supabase no se toca.
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { isDemo, disableDemo, DEMO_USER } from '../demo/mode.js';

const AuthContext = createContext(null);

/** Sale del demo con recarga completa, para no arrastrar estado ni cache. */
function leaveDemo(to = '/') {
  disableDemo();
  window.location.assign(to);
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const demo = isDemo();

  useEffect(() => {
    if (demo) { setLoading(false); return; }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, [demo]);

  const value = demo
    ? {
        session: { user: DEMO_USER },
        user:    DEMO_USER,
        loading: false,
        // Login.jsx redirige apenas hay sesión, así que en demo esto es una red de
        // seguridad: si alguien llega igual, sale del demo antes de autenticarse.
        signIn:  async () => { leaveDemo('/login'); return { error: null }; },
        signUp:  async () => { leaveDemo('/login'); return { error: null }; },
        signOut: async () => { leaveDemo('/'); },
      }
    : {
        session,
        user: session?.user || null,
        loading,
        signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
        signUp: (email, password, name) =>
          supabase.auth.signUp({
            email, password,
            options: {
              data: { name },
              // Redirigir al dominio real, no localhost
              emailRedirectTo: `${window.location.origin}/`,
            },
          }),
        signOut: () => supabase.auth.signOut(),
      };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
