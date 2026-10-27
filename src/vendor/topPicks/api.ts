import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { db, must } from '../../lib/queries';
import type { InvoiceStatus } from '../../lib/types';
import { VENDOR_KEY } from '../api';

export type TopPickStatus = 'awaiting_payment' | 'waiting' | 'live' | 'ended' | 'removed' | 'cancelled';

export interface TopPickLength {
  id: number;
  days: number;
  price: number;
}

export interface TopPickDistrict {
  id: number;
  name: string;
  live: number;
  waiting: number;
  /** The day the first place opens if nobody renews. */
  next_free_on: string | null;
  /** This offer already runs (or waits) here. */
  taken: boolean;
}

export interface TopPickOffer {
  id: number;
  title: string;
  discount_label: string | null;
  image_key: string | null;
  ends_on: string | null;
  shop_id: number;
  is_paused: boolean;
  districts: TopPickDistrict[];
}

export interface MyTopPick {
  id: number;
  status: TopPickStatus;
  offer_id: number;
  offer_title: string;
  offer_image_key: string | null;
  /** False while the offer is paused, in review, or its shop is hidden: the card is not shown then. */
  offer_live: boolean;
  offer_ends_on: string | null;
  shop_id: number;
  district_id: number;
  district_name: string;
  branch_name: string | null;
  starts_on: string | null;
  ends_on: string | null;
  waiting_days: number;
  removed_reason: string | null;
  ended_at: string | null;
  position: number | null;
  waiting_position: number | null;
  views: number;
  taps: number;
  open_invoice: { id: number; number: string; status: InvoiceStatus; total: number } | null;
}

export interface TopPicksInfo {
  enabled: boolean;
  places: number;
  is_owner: boolean;
  managers_can_sponsor: boolean;
  /** False for a branch manager when the owner switched buying off. */
  allowed: boolean;
  lengths: TopPickLength[];
  offers: TopPickOffer[];
  picks: MyTopPick[];
}

const KEY = [...VENDOR_KEY, 'top-picks'] as const;

export function useMyTopPicks() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => must<TopPicksInfo>(await db().rpc('my_top_picks')),
  });
}

function useRefresh() {
  const qc = useQueryClient();
  return async () => {
    await qc.invalidateQueries({ queryKey: KEY });
    await qc.invalidateQueries({ queryKey: [...VENDOR_KEY, 'billing'] });
  };
}

/** Resolves the invoice to pay (already paid when the length is free). */
export function useBuyTopPick() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (v: { offerId: number; districtId: number; lengthId: number }) =>
      must<number>(
        await db().rpc('buy_top_pick', {
          p_offer_id: v.offerId,
          p_district_id: v.districtId,
          p_length_id: v.lengthId,
        }),
      ),
    onSuccess: refresh,
  });
}

export function useRenewTopPick() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (v: { id: number; lengthId: number }) =>
      must<number>(await db().rpc('renew_top_pick', { p_id: v.id, p_length_id: v.lengthId })),
    onSuccess: refresh,
  });
}

export function useSwapTopPickOffer() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (v: { id: number; offerId: number }) =>
      must(await db().rpc('swap_top_pick_offer', { p_id: v.id, p_offer_id: v.offerId })),
    onSuccess: refresh,
  });
}

export function useSetManagersCanSponsor() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (allowed: boolean) =>
      must(await db().rpc('set_managers_can_sponsor', { p_allowed: allowed })),
    onSuccess: refresh,
  });
}
