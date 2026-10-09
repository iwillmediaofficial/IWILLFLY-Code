import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { db, must } from './queries';
import { supabase } from './supabase';

export interface MyProfile {
  full_name: string | null;
  phone: string | null;
  location_id: number | null;
}

/** The signed-in user's own profile row. */
export function useMyProfile() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ['my-profile', userId],
    queryFn: async () =>
      must<MyProfile | null>(
        await db().from('profiles').select('full_name, phone, location_id').eq('id', userId!).maybeSingle(),
      ),
    enabled: Boolean(supabase && userId),
  });
}

/**
 * True when a customer still has to give their mobile number or area, e.g. after their first Google
 * sign-in. Details given at password sign-up count too, since they are copied into the profile a moment
 * after the first sign-in (see AuthProvider).
 */
export function useNeedsProfile() {
  const { session, roles, loading } = useAuth();
  const profile = useMyProfile();
  if (loading || !session || !profile.isSuccess || !profile.data) return false;
  if (roles.some((r) => r !== 'customer')) return false;
  const meta = session.user.user_metadata ?? {};
  const hasPhone = Boolean(profile.data.phone || meta.phone);
  const hasArea = profile.data.location_id != null || typeof meta.location_id === 'number';
  return !hasPhone || !hasArea;
}
