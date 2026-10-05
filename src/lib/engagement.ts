import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useAuth } from '../auth/AuthProvider';
import { db, must } from './queries';
import type { AppNotification, TrackEvent } from './types';

const seen = new Set<string>();

/**
 * Counts a customer action for the shop/offer analytics. Fire and forget: never blocks the UI and
 * never shows an error. Views are sent once per page load for each shop or offer.
 */
export function track(event: TrackEvent, shopId: number, offerId?: number | null) {
  if (!supabase) return;
  const key = `${event}:${shopId}:${offerId ?? ''}`;
  if (event === 'view' && seen.has(key)) return;
  seen.add(key);
  void supabase.rpc('track_event', { p_event: event, p_shop_id: shopId, p_offer_id: offerId ?? null }).then(
    () => undefined,
    () => undefined,
  );
}

/** The signed-in user's inbox, newest first (last 100). */
export function useNotifications() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['notifications', session?.user.id ?? null],
    queryFn: async () =>
      must<AppNotification[]>(
        await db().from('notifications').select('*').order('created_at', { ascending: false }).limit(100),
      ),
    enabled: Boolean(supabase && session),
  });
}

export function useUnreadCount() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['notifications', 'unread', session?.user.id ?? null],
    queryFn: async () => {
      const { count, error } = await db()
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .is('read_at', null);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
    enabled: Boolean(supabase && session),
    refetchInterval: 2 * 60_000,
  });
}

/** Marks one message read, or all of them when no id is given. */
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id?: number) => {
      let q = db().from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
      if (id) q = q.eq('id', id);
      must(await q);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
