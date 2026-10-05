import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
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

const profileChecked = new Set<string>();

/**
 * Copies the name, mobile and area given at password sign-up into the profile row.
 * Runs on sign-in because with email confirmation on there is no session at sign-up time.
 * Only fills empty fields, so later edits are never overwritten.
 */
async function fillProfileFromSignup(user: User) {
  const m = user.user_metadata ?? {};
  const phone = typeof m.phone === 'string' ? m.phone : null;
  const locationId = typeof m.location_id === 'number' ? m.location_id : null;
  if (!supabase || (!phone && locationId == null) || profileChecked.has(user.id)) return;
  profileChecked.add(user.id);
  const { data } = await supabase
    .from('profiles')
    .select('full_name, phone, location_id')
    .eq('id', user.id)
    .maybeSingle();
  if (!data) return;
  const patch: Record<string, string | number> = {};
  if (!data.full_name && typeof m.full_name === 'string') patch.full_name = m.full_name;
  if (!data.phone && phone) patch.phone = phone;
  if (data.location_id == null && locationId != null) patch.location_id = locationId;
  if (Object.keys(patch).length) await supabase.from('profiles').update(patch).eq('id', user.id);
}

interface VendorApplication {
  business_name: string;
  phone: string;
  whatsapp: string;
}

const vendorFiling = new Map<string, Promise<void>>();

/**
 * Files the vendor application saved by the vendor sign-up form (/vendor/signup) the first time the
 * account has a session, then clears it from the metadata so it is never filed again.
 * apply_as_vendor ignores repeats, and concurrent callers share one promise.
 */
function fileVendorApplication(user: User): Promise<void> {
  const app = user.user_metadata?.vendor_application as VendorApplication | null | undefined;
  if (!supabase || !app?.business_name) return Promise.resolve();
  const sb = supabase;
  let p = vendorFiling.get(user.id);
  if (!p) {
    p = (async () => {
      const { error } = await sb.rpc('apply_as_vendor', {
        p_business_name: app.business_name,
        p_phone: app.phone ?? '',
        p_whatsapp: app.whatsapp ?? '',
      });
      if (error) {
        vendorFiling.delete(user.id); // let a later sign-in retry
        return;
      }
      await sb.auth.updateUser({ data: { vendor_application: null } });
    })();
    vendorFiling.set(user.id, p);
  }
  return p;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(Boolean(supabase));

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    const apply = async (s: Session | null) => {
      if (s) {
        void fillProfileFromSignup(s.user);
        await fileVendorApplication(s.user);
      }
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
