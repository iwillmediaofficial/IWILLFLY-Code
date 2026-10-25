import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { db, must } from '../lib/queries';
import type { Branch, MyVendor, Offer, Shop } from '../lib/types';
import { useVendor } from './context';

// Every vendor-area query key starts with 'vendor', so a save can refresh them all at once.
export const VENDOR_KEY = ['vendor'] as const;

export function useMyVendorRow() {
  const { session } = useAuth();
  const uid = session?.user.id;
  return useQuery({
    queryKey: ['vendor', 'me', uid],
    // my_vendor() also finds the business for managers and staff, with their role in it.
    queryFn: async () => must<MyVendor | null>(await db().rpc('my_vendor')),
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

/** Every branch of the vendor's shops (branch members see them all, but change only their own). */
export function useMyBranches() {
  const shops = useMyShops();
  const ids = (shops.data ?? []).map((s) => s.id);
  return useQuery({
    queryKey: ['vendor', 'all-branches', ids],
    queryFn: async () =>
      ids.length
        ? must<Branch[]>(await db().from('branches').select('*').in('shop_id', ids).order('id'))
        : [],
    enabled: shops.isSuccess,
  });
}

/** Offers of the vendor's own shops, newest first, with the branches of branch-only offers. */
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
  const offerIds = (offers.data ?? []).filter((o) => !o.all_branches).map((o) => o.id);
  const links = useQuery({
    queryKey: ['vendor', 'offer-branches', offerIds],
    queryFn: async () => {
      const rows = offerIds.length
        ? must<{ offer_id: number; branch_id: number }[]>(
            await db().from('offer_branches').select('offer_id, branch_id').in('offer_id', offerIds),
          )
        : [];
      const map = new Map<number, number[]>();
      for (const r of rows) map.set(r.offer_id, [...(map.get(r.offer_id) ?? []), r.branch_id]);
      return map;
    },
    enabled: offers.isSuccess,
  });
  return {
    offers: offers.data,
    shops: shops.data,
    /** offer id -> branch ids, for offers that are not for all branches */
    branchesOf: links.data,
    isPending: shops.isPending || offers.isPending || links.isPending,
    error: shops.error ?? offers.error ?? links.error,
  };
}
