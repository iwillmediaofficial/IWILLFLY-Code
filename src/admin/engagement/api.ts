import { useEffect, useState } from 'react';
import { useQuery, type QueryKey } from '@tanstack/react-query';
import { db, must } from '../../lib/queries';
import type {
  Ad,
  AdminAnalytics,
  Broadcast,
  BroadcastAudience,
  Festival,
  FestivalOfferRow,
  Offer,
  PlacementKind,
  PlacementRequest,
  RequestStatus,
  ReviewStatus,
} from '../../lib/types';

/** Every admin engagement query key starts with this, so one invalidate refreshes them all. */
export const ENG_KEY = 'admin-eng';

/** Keys to refresh after a manager change: these screens plus the offer lists a featured flag changes. */
export const ENG_KEYS: QueryKey[] = [[ENG_KEY], ['search_offers'], ['admin_stats'], ['admin', 'offers']];

/** Today's date in India as "YYYY-MM-DD". */
export function todayIST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/** "2026-10-05" plus n days (n may be negative). */
export function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Status -------------------------------------------------------------------------------------------

export type FestivalStatus = 'live' | 'upcoming' | 'ended' | 'off';

export function festivalStatus(f: Pick<Festival, 'is_active' | 'starts_on' | 'ends_on'>): FestivalStatus {
  if (!f.is_active) return 'off';
  const today = todayIST();
  if (f.ends_on < today) return 'ended';
  if (f.starts_on > today) return 'upcoming';
  return 'live';
}

export type AdStatus = 'running' | 'scheduled' | 'ended' | 'off';

export function adStatus(a: Pick<Ad, 'is_active' | 'starts_on' | 'ends_on'>): AdStatus {
  if (!a.is_active) return 'off';
  const today = todayIST();
  if (a.ends_on && a.ends_on < today) return 'ended';
  if (a.starts_on > today) return 'scheduled';
  return 'running';
}

// Festivals ----------------------------------------------------------------------------------------

export type FestivalListRow = Festival & { festival_offers: { status: ReviewStatus }[] };

export function useFestivals() {
  return useQuery({
    queryKey: [ENG_KEY, 'festivals'],
    queryFn: async () =>
      must<FestivalListRow[]>(
        await db()
          .from('festivals')
          .select('*, festival_offers(status)')
          .order('sort_order')
          .order('starts_on', { ascending: false }),
      ),
  });
}

export function useFestival(id: number | null) {
  return useQuery({
    queryKey: [ENG_KEY, 'festival', id],
    queryFn: async () => must<Festival>(await db().from('festivals').select('*').eq('id', id!).single()),
    enabled: id != null,
  });
}

export type FestivalInput = Pick<
  Festival,
  | 'name'
  | 'slug'
  | 'description'
  | 'banner_key'
  | 'theme_color'
  | 'starts_on'
  | 'ends_on'
  | 'submissions_close_on'
  | 'is_active'
  | 'sort_order'
>;

/** Inserts or updates a festival and returns its id. */
export async function saveFestival(id: number | null, row: FestivalInput) {
  if (id != null) {
    must(await db().from('festivals').update(row).eq('id', id));
    return id;
  }
  return must<{ id: number }>(await db().from('festivals').insert(row).select('id').single()).id;
}

export async function deleteFestival(id: number) {
  must(await db().from('festivals').delete().eq('id', id));
}

type ShopName = { name: string };
export type SubmissionOffer = Pick<Offer, 'id' | 'title' | 'discount_label' | 'image_keys' | 'status'> & {
  shop: ShopName | ShopName[] | null;
};
export type SubmissionRow = FestivalOfferRow & { offer: SubmissionOffer | SubmissionOffer[] | null };

export function useSubmissions(festivalId: number, status: ReviewStatus) {
  return useQuery({
    queryKey: [ENG_KEY, 'submissions', festivalId, status],
    queryFn: async () =>
      must<SubmissionRow[]>(
        await db()
          .from('festival_offers')
          .select('*, offer:offers(id, title, discount_label, image_keys, status, shop:shops(name))')
          .eq('festival_id', festivalId)
          .eq('status', status)
          .order('submitted_at', { ascending: status === 'pending' })
          .limit(200),
      ),
  });
}

export async function reviewSubmission(
  festivalId: number,
  offerId: number,
  status: ReviewStatus,
  note: string | null,
) {
  must(
    await db()
      .from('festival_offers')
      .update({ status, note })
      .eq('festival_id', festivalId)
      .eq('offer_id', offerId),
  );
}

// Home ads -----------------------------------------------------------------------------------------

export function useAds() {
  return useQuery({
    queryKey: [ENG_KEY, 'ads'],
    queryFn: async () =>
      must<Ad[]>(await db().from('ads').select('*').order('sort_order').order('id', { ascending: false })),
  });
}

export function useAd(id: number | null) {
  return useQuery({
    queryKey: [ENG_KEY, 'ad', id],
    queryFn: async () => must<Ad>(await db().from('ads').select('*').eq('id', id!).single()),
    enabled: id != null,
  });
}

export type AdInput = Pick<
  Ad,
  | 'pill'
  | 'title'
  | 'subtitle'
  | 'image_key'
  | 'style'
  | 'link_kind'
  | 'link_target'
  | 'vendor_id'
  | 'starts_on'
  | 'ends_on'
  | 'sort_order'
  | 'is_active'
>;

export async function saveAd(id: number | null, row: AdInput) {
  if (id != null) {
    must(await db().from('ads').update(row).eq('id', id));
    return id;
  }
  return must<{ id: number }>(await db().from('ads').insert(row).select('id').single()).id;
}

export async function deleteAd(id: number) {
  must(await db().from('ads').delete().eq('id', id));
}

/** Writes sort_order 10, 20, 30… in the given order (only rows whose order changes). */
export async function reorderAds(ordered: Pick<Ad, 'id' | 'sort_order'>[]) {
  const changes = ordered
    .map((a, i) => ({ id: a.id, from: a.sort_order, to: (i + 1) * 10 }))
    .filter((c) => c.from !== c.to);
  for (const c of changes) {
    must(await db().from('ads').update({ sort_order: c.to }).eq('id', c.id));
  }
}

export type NamedRef = { id: number; name: string };

/** Shops, malls and vendors for link pickers. */
export function useShopRefs(enabled = true) {
  return useQuery({
    queryKey: [ENG_KEY, 'shop-refs'],
    queryFn: async () =>
      must<NamedRef[]>(await db().from('shops').select('id, name').order('name').limit(1000)),
    enabled,
  });
}

export function useMallRefs(enabled = true) {
  return useQuery({
    queryKey: [ENG_KEY, 'mall-refs'],
    queryFn: async () => must<NamedRef[]>(await db().from('malls').select('id, name').order('name')),
    enabled,
  });
}

export function useVendorRefs() {
  return useQuery({
    queryKey: [ENG_KEY, 'vendor-refs'],
    queryFn: async () =>
      must<{ id: number; business_name: string }[]>(
        await db()
          .from('vendors')
          .select('id, business_name')
          .eq('status', 'approved')
          .order('business_name'),
      ),
  });
}

// Placement requests -------------------------------------------------------------------------------

export const PLACEMENT_LABEL: Record<PlacementKind, string> = {
  featured_offer: 'Featured offer',
  home_banner: 'Home banner',
  festival_spotlight: 'Festival spotlight',
};

type Ref<T> = T | T[] | null;
export type RequestRow = PlacementRequest & {
  vendor: Ref<{ id: number; business_name: string }>;
  offer: Ref<{ id: number; title: string; is_featured: boolean }>;
  shop: Ref<{ id: number; name: string }>;
  festival: Ref<{ id: number; name: string; slug: string }>;
};

export function useRequests(status: RequestStatus) {
  return useQuery({
    queryKey: [ENG_KEY, 'requests', status],
    queryFn: async () =>
      must<RequestRow[]>(
        await db()
          .from('placement_requests')
          .select(
            '*, vendor:vendors(id, business_name), offer:offers(id, title, is_featured), shop:shops(id, name), festival:festivals(id, name, slug)',
          )
          .eq('status', status)
          .order('created_at', { ascending: status === 'pending' })
          .limit(200),
      ),
  });
}

export async function decideRequest(id: number, status: 'approved' | 'rejected', note: string | null) {
  must(await db().from('placement_requests').update({ status, admin_note: note }).eq('id', id));
}

// Notifications ------------------------------------------------------------------------------------

/** Returns `value` once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms = 400) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useAudienceSize(
  audience: BroadcastAudience,
  locationId: number | null,
  categoryId: number | null,
) {
  const key = useDebounced(`${audience}|${locationId ?? ''}|${categoryId ?? ''}`);
  return useQuery({
    queryKey: [ENG_KEY, 'audience', key],
    queryFn: async () => {
      const [a, l, c] = key.split('|');
      return Number(
        must<number>(
          await db().rpc('broadcast_audience_size', {
            p_audience: a,
            p_location_id: l ? Number(l) : null,
            p_category_id: c ? Number(c) : null,
          }),
        ),
      );
    },
  });
}

export type BroadcastInput = {
  title: string;
  body: string | null;
  link: string | null;
  audience: BroadcastAudience;
  location_id: number | null;
  category_id: number | null;
  push: boolean;
};

export async function sendBroadcast(b: BroadcastInput) {
  return must<{ broadcast_id: number; recipients: number }>(
    await db().rpc('send_broadcast', {
      p_title: b.title,
      p_body: b.body,
      p_link: b.link,
      p_audience: b.audience,
      p_location_id: b.location_id,
      p_category_id: b.category_id,
      p_push: b.push,
    }),
  );
}

export function useBroadcasts() {
  return useQuery({
    queryKey: [ENG_KEY, 'broadcasts'],
    queryFn: async () =>
      must<Broadcast[]>(
        await db().from('broadcasts').select('*').order('created_at', { ascending: false }).limit(50),
      ),
  });
}

// Analytics ----------------------------------------------------------------------------------------

export function useAdminAnalytics(from: string, to: string) {
  return useQuery({
    queryKey: [ENG_KEY, 'analytics', from, to],
    queryFn: async () => must<AdminAnalytics>(await db().rpc('admin_analytics', { p_from: from, p_to: to })),
  });
}

/** Postgres errors in words a manager can act on. */
export function engError(err: unknown, inUse = 'This is still in use, so it cannot be removed.') {
  const msg = err instanceof Error ? err.message : String(err);
  if (/duplicate key|unique constraint/i.test(msg)) return 'That web address (slug) is already used.';
  if (/foreign key/i.test(msg)) return inUse;
  if (/slug/i.test(msg)) return 'The web address may only use small letters, numbers and dashes.';
  if (/theme_color/i.test(msg)) return 'Pick a colour like #1760d9.';
  if (/ends_on|starts_on/i.test(msg)) return 'The end date cannot be before the start date.';
  if (/link_target/i.test(msg)) return 'Choose where the ad opens.';
  if (/violates check constraint/i.test(msg)) return 'Some values are too long or out of range.';
  return msg;
}
