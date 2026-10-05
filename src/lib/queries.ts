import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useAuth } from '../auth/AuthProvider';
import { usePlace } from './location';
import type { Category, LocationNode, MallResult, OfferResult, ShopResult } from './types';

/** The Supabase client, or a clear error when the app was built without its keys. */
export function db() {
  if (!supabase) throw new Error('Sign in is not set up yet');
  return supabase;
}

/** Throws Supabase errors so TanStack Query reports them. */
export function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async () =>
      must<Category[]>(
        await db().from('categories').select('*').eq('is_active', true).order('sort_order').order('name'),
      ),
    staleTime: 10 * 60_000,
    enabled: Boolean(supabase),
  });
}

export function useLocations() {
  return useQuery({
    queryKey: ['locations'],
    queryFn: async () =>
      must<LocationNode[]>(await db().from('locations').select('*').order('sort_order').order('name')),
    staleTime: 10 * 60_000,
    enabled: Boolean(supabase),
  });
}

export function useShopSearch(opts: {
  category?: string | null;
  q?: string;
  mallId?: number | null;
  limit?: number;
}) {
  const { place } = usePlace();
  return useQuery({
    queryKey: [
      'search_shops',
      place?.lat,
      place?.lng,
      opts.category ?? null,
      opts.q ?? '',
      opts.mallId ?? null,
      opts.limit,
    ],
    queryFn: async () =>
      must<ShopResult[]>(
        await db().rpc('search_shops', {
          p_lat: place?.lat ?? null,
          p_lng: place?.lng ?? null,
          p_category: opts.category || null,
          p_q: opts.q || null,
          p_mall_id: opts.mallId ?? null,
          p_limit: opts.limit ?? 30,
        }),
      ),
    enabled: Boolean(supabase),
  });
}

export function useOfferSearch(
  opts: { category?: string | null; featuredOnly?: boolean; limit?: number } = {},
) {
  const { place } = usePlace();
  return useQuery({
    queryKey: [
      'search_offers',
      place?.lat,
      place?.lng,
      opts.category ?? null,
      opts.featuredOnly ?? false,
      opts.limit,
    ],
    queryFn: async () =>
      must<OfferResult[]>(
        await db().rpc('search_offers', {
          p_lat: place?.lat ?? null,
          p_lng: place?.lng ?? null,
          p_category: opts.category || null,
          p_featured_only: opts.featuredOnly ?? false,
          p_limit: opts.limit ?? 20,
        }),
      ),
    enabled: Boolean(supabase),
  });
}

export function useMalls() {
  const { place } = usePlace();
  return useQuery({
    queryKey: ['list_malls', place?.lat, place?.lng],
    queryFn: async () =>
      must<MallResult[]>(
        await db().rpc('list_malls', { p_lat: place?.lat ?? null, p_lng: place?.lng ?? null }),
      ),
    enabled: Boolean(supabase),
  });
}

type SaveKind = 'offer' | 'shop';
const saveTable = { offer: 'saved_offers', shop: 'saved_shops' } as const;
const saveColumn = { offer: 'offer_id', shop: 'shop_id' } as const;

/** Ids the signed-in user has saved. Empty when signed out. */
export function useSavedIds(kind: SaveKind) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['saved', kind, session?.user.id],
    queryFn: async () => {
      const rows = must<Record<string, number>[]>(await db().from(saveTable[kind]).select(saveColumn[kind]));
      return new Set(rows.map((r) => r[saveColumn[kind]]));
    },
    enabled: Boolean(session),
  });
}

/** Save or unsave an offer or shop. Callers check sign-in first. */
export function useToggleSaved(kind: SaveKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, saved }: { id: number; saved: boolean }) => {
      const t = db().from(saveTable[kind]);
      if (saved) must(await t.delete().eq(saveColumn[kind], id));
      else must(await t.insert(kind === 'offer' ? { offer_id: id } : { shop_id: id }));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['saved', kind] }),
  });
}
