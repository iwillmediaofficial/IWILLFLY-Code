import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export type AppRole = 'customer' | 'vendor' | 'admin' | 'super_admin' | 'support' | 'campaign_manager';

interface AuthState {
  session: Session | null;
  roles: AppRole[];
  loading: boolean;
  signOut: () => Promise<void>;
  /** Re-read roles, e.g. after applying as a vendor. */
  refreshRoles: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null,
  roles: [],
  loading: false,
  signOut: async () => {},
  refreshRoles: async () => {},
});

async function fetchRoles(userId: string): Promise<AppRole[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('user_roles').select('role').eq('user_id', userId);
  if (error) return [];
  return data.map((r) => r.role as AppRole);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(Boolean(supabase));

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    const apply = async (s: Session | null) => {
      const r = s ? await fetchRoles(s.user.id) : [];
      if (!active) return;
      setSession(s);
      setRoles(r);
      setLoading(false);
    };
    supabase.auth.getSession().then(({ data }) => apply(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      // Defer so the Supabase client is not called from inside its own callback.
      setTimeout(() => apply(s), 0);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase?.auth.signOut();
  };

  const refreshRoles = async () => {
    if (session) setRoles(await fetchRoles(session.user.id));
  };

  return (
    <AuthContext.Provider value={{ session, roles, loading, signOut, refreshRoles }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext);
}

/** Admin-type roles that can open the admin area. */
// eslint-disable-next-line react-refresh/only-export-components
export const ADMIN_ROLES: AppRole[] = ['admin', 'super_admin', 'support', 'campaign_manager'];

// eslint-disable-next-line react-refresh/only-export-components
export function homeFor(roles: AppRole[]) {
  if (roles.some((r) => ADMIN_ROLES.includes(r))) return '/admin';
  if (roles.includes('vendor')) return '/vendor';
  return '/';
}
