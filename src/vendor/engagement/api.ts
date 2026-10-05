import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { db, must } from '../../lib/queries';
import type {
  Festival,
  FestivalOfferRow,
  PlacementKind,
  PlacementRequest,
  VendorAnalytics,
} from '../../lib/types';
import { useMyOffers } from '../api';
import { useVendor } from '../context';
import { todayIST } from '../format';

// Every vendor engagement query key starts with 'vendor-eng', so one save can refresh them all.
export const ENG_KEY = ['vendor-eng'] as const;

/** "2026-10-05" plus n days (n may be negative). */
export function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The last `days` days up to today, India time. */
export function rangeFor(days: number, today = todayIST()) {
  return { from: addDays(today, -(days - 1)), to: today };
}

/** Counters for the vendor's shops and offers over the last `days` days (at most 92). */
export function useVendorAnalytics(days: number) {
  const vendor = useVendor();
  const { from, to } = rangeFor(days);
  return useQuery({
    queryKey: ['vendor-eng', 'analytics', vendor.id, from, to],
    queryFn: async () =>
      must<VendorAnalytics>(await db().rpc('vendor_analytics', { p_from: from, p_to: to })),
    staleTime: 5 * 60_000,
  });
}

/** Festivals customers can see right now (RLS shows active ones), soonest first. */
export function useActiveFestivals() {
  const vendor = useVendor();
  return useQuery({
    queryKey: ['vendor-eng', 'festivals', vendor.id],
    queryFn: async () =>
      must<Festival[]>(
        await db().from('festivals').select('*').eq('is_active', true).order('sort_order').order('starts_on'),
      ),
  });
}

/** This vendor's festival submissions. RLS also returns other vendors' approved rows, so filter by offer. */
export function useMySubmissions(offerIds: number[] | undefined) {
  const vendor = useVendor();
  return useQuery({
    queryKey: ['vendor-eng', 'submissions', vendor.id, offerIds],
    queryFn: async () =>
      offerIds!.length
        ? must<FestivalOfferRow[]>(await db().from('festival_offers').select('*').in('offer_id', offerIds!))
        : [],
    enabled: offerIds != null,
  });
}

/** Festivals, the vendor's offers and shops, and their submissions in one go. */
export function useFestivalData() {
  const { offers, shops, isPending, error } = useMyOffers();
  const festivals = useActiveFestivals();
  const submissions = useMySubmissions(offers?.map((o) => o.id));
  return {
    festivals: festivals.data,
    offers,
    shops,
    submissions: submissions.data,
    isPending: isPending || festivals.isPending || submissions.isPending,
    error: error ?? festivals.error ?? submissions.error,
  };
}

/** Submits an offer to a festival (it starts pending), or withdraws it. */
export function useFestivalSubmission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      festivalId,
      offerId,
      submit,
    }: {
      festivalId: number;
      offerId: number;
      submit: boolean;
    }) =>
      submit
        ? must(await db().from('festival_offers').insert({ festival_id: festivalId, offer_id: offerId }))
        : must(
            await db().from('festival_offers').delete().eq('festival_id', festivalId).eq('offer_id', offerId),
          ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ENG_KEY }),
  });
}

/** This vendor's placement requests, newest first. */
export function useMyPlacementRequests() {
  const vendor = useVendor();
  return useQuery({
    queryKey: ['vendor-eng', 'placements', vendor.id],
    queryFn: async () =>
      must<PlacementRequest[]>(
        await db()
          .from('placement_requests')
          .select('*')
          .eq('vendor_id', vendor.id)
          .order('created_at', { ascending: false }),
      ),
  });
}

export interface PlacementInput {
  kind: PlacementKind;
  offer_id: number | null;
  shop_id: number | null;
  festival_id: number | null;
  message: string | null;
  wanted_from: string | null;
  wanted_to: string | null;
}

export function useRequestPlacement() {
  const vendor = useVendor();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PlacementInput) =>
      must(
        await db()
          .from('placement_requests')
          .insert({ ...input, vendor_id: vendor.id }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ENG_KEY }),
  });
}

/** Cancels a pending request (the database refuses anything else). */
export function useCancelPlacement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) =>
      must(await db().from('placement_requests').update({ status: 'cancelled' }).eq('id', id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ENG_KEY }),
  });
}
