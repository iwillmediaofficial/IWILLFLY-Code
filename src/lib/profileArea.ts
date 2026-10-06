import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { haversineKm } from './hours';
import { db, must } from './queries';
import { supabase } from './supabase';
import type { LocationNode } from './types';

/** Further than this from every area, a GPS reading is treated as outside the areas we serve. */
export const NEAREST_AREA_MAX_KM = 40;

/**
 * The signed-in customer's saved area (profiles.location_id). Scratch & Win uses it to decide which
 * campaigns and prizes they can play, so it must be set before scratching.
 */
export function useProfileArea() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['profile-area', userId],
    queryFn: async () =>
      must<{ location_id: number | null } | null>(
        await db().from('profiles').select('location_id').eq('id', userId!).maybeSingle(),
      )?.location_id ?? null,
    enabled: Boolean(supabase && userId),
  });
  const save = useMutation({
    mutationFn: async (locationId: number) => {
      must(await db().from('profiles').update({ location_id: locationId }).eq('id', userId!));
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['profile-area', userId] });
      // Which campaigns the customer can play depends on their area.
      await qc.refetchQueries({ queryKey: ['scratch_today'] });
    },
  });
  return {
    /** null when not set (or not signed in). */
    areaId: query.data ?? null,
    /** False until the saved area has been read, so callers don't flash a "set location" prompt. */
    known: Boolean(userId) && query.isSuccess,
    save,
  };
}

/** The area's own map point, or its nearest parent's (city, district) when the area has none. */
export function pointFor(all: LocationNode[], area: LocationNode) {
  const byId = new Map(all.map((l) => [l.id, l]));
  let cur: LocationNode | undefined = area;
  while (cur) {
    if (cur.lat != null && cur.lng != null) return { lat: cur.lat, lng: cur.lng };
    cur = cur.parent_id != null ? byId.get(cur.parent_id) : undefined;
  }
  return null;
}

/** The active area closest to a point, with its distance in km. Areas with their own map point win ties. */
export function nearestArea(all: LocationNode[], at: { lat: number; lng: number }) {
  let best: { area: LocationNode; km: number; own: boolean } | null = null;
  for (const area of all) {
    if (area.kind !== 'area' || !area.is_active) continue;
    const p = pointFor(all, area);
    if (!p) continue;
    const km = haversineKm(at, p);
    const own = area.lat != null && area.lng != null;
    if (!best || km < best.km - 0.001 || (Math.abs(km - best.km) <= 0.001 && own && !best.own))
      best = { area, km, own };
  }
  return best && { area: best.area, km: best.km };
}
