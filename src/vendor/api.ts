import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { db, must } from '../lib/queries';
import type { Branch, Offer, Shop, Vendor } from '../lib/types';
import { useVendor } from './context';

// Every vendor-area query key starts with 'vendor', so a save can refresh them all at once.
export const VENDOR_KEY = ['vendor'] as const;

export function useMyVendorRow() {
  const { session } = useAuth();
  const uid = session?.user.id;
  return useQuery({
    queryKey: ['vendor', 'me', uid],
    queryFn: async () =>
      must<Vendor | null>(await db().from('vendors').select('*').eq('owner_id', uid!).maybeSingle()),
    enabled: Boolean(uid),
  });
}

/** Own shops only: the shops table also exposes other vendors' live shops, so filter by vendor. */
export function useMyShops() {
  const vendor = useVendor();
  return useQuery({
    queryKey: ['vendor', 'shops', vendor.id],
    queryFn: async () =>
      must<Shop[]>(
        await db()
          .from('shops')
          .select('*')
          .eq('vendor_id', vendor.id)
          .order('created_at', { ascending: true }),
      ),
  });
}

export function useBranches(shopId: number | null) {
  return useQuery({
    queryKey: ['vendor', 'branches', shopId],
    queryFn: async () =>
      must<Branch[]>(await db().from('branches').select('*').eq('shop_id', shopId!).order('id')),
    enabled: shopId != null,
  });
}

export function useBranch(id: number | null) {
  return useQuery({
    queryKey: ['vendor', 'branch', id],
    queryFn: async () =>
      must<Branch | null>(await db().from('branches').select('*').eq('id', id!).maybeSingle()),
    enabled: id != null,
  });
}

/** Offers of the vendor's own shops, newest first. */
export function useMyOffers() {
  const shops = useMyShops();
  const ids = (shops.data ?? []).map((s) => s.id);
  const offers = useQuery({
    queryKey: ['vendor', 'offers', ids],
    queryFn: async () =>
      ids.length
        ? must<Offer[]>(
            await db()
              .from('offers')
              .select('*')
              .in('shop_id', ids)
              .order('created_at', { ascending: false }),
          )
        : [],
    enabled: shops.isSuccess,
  });
  return {
    offers: offers.data,
    shops: shops.data,
    isPending: shops.isPending || offers.isPending,
    error: shops.error ?? offers.error,
  };
}
