import { useQuery, type QueryKey } from '@tanstack/react-query';
import { db, must } from '../../lib/queries';
import type {
  CampaignPrizeStats,
  CampaignWinner,
  ClaimLookup,
  ScratchCampaign,
  ScratchPrize,
  Vendor,
} from '../../lib/types';

/** Every admin Scratch & Win query key starts with this, so one invalidate refreshes them all. */
export const SCRATCH_KEY = 'admin-scratch';

/** Keys to refresh after any manager change: the admin screens plus the customer home/scratch lists. */
export const SCRATCH_KEYS: QueryKey[] = [[SCRATCH_KEY], ['scratch_today']];

export type CampaignListRow = ScratchCampaign & {
  scratch_prizes: { count: number }[];
  campaign_vendors: { count: number }[];
};

export type VendorRef = Pick<Vendor, 'id' | 'business_name' | 'status'>;

export type CampaignVendorRow = {
  vendor_id: number;
  joined_at: string;
  vendor: VendorRef | VendorRef[] | null;
};

export type CampaignStatus = 'live' | 'scheduled' | 'ended' | 'off';

/** Today's date in India as "YYYY-MM-DD" (campaign dates are India dates). */
export function todayIST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

export function campaignStatus(
  c: Pick<ScratchCampaign, 'is_active' | 'starts_on' | 'ends_on'>,
): CampaignStatus {
  if (!c.is_active) return 'off';
  const today = todayIST();
  if (c.ends_on && c.ends_on < today) return 'ended';
  if (c.starts_on > today) return 'scheduled';
  return 'live';
}

export function useCampaigns() {
  return useQuery({
    queryKey: [SCRATCH_KEY, 'campaigns'],
    queryFn: async () =>
      must<CampaignListRow[]>(
        await db()
          .from('scratch_campaigns')
          .select('*, scratch_prizes(count), campaign_vendors(count)')
          .order('starts_on', { ascending: false })
          .order('id', { ascending: false }),
      ),
  });
}

export function useCampaign(id: number | null) {
  return useQuery({
    queryKey: [SCRATCH_KEY, 'campaign', id],
    queryFn: async () =>
      must<ScratchCampaign>(await db().from('scratch_campaigns').select('*').eq('id', id!).single()),
    enabled: id != null,
  });
}

export function usePrizes(campaignId: number) {
  return useQuery({
    queryKey: [SCRATCH_KEY, 'prizes', campaignId],
    queryFn: async () =>
      must<ScratchPrize[]>(
        await db().from('scratch_prizes').select('*').eq('campaign_id', campaignId).order('id'),
      ).map((p) => ({ ...p, probability: Number(p.probability) })),
  });
}

export function useCampaignVendors(campaignId: number) {
  return useQuery({
    queryKey: [SCRATCH_KEY, 'campaign-vendors', campaignId],
    queryFn: async () =>
      must<CampaignVendorRow[]>(
        await db()
          .from('campaign_vendors')
          .select('vendor_id, joined_at, vendor:vendors(id, business_name, status)')
          .eq('campaign_id', campaignId)
          .order('joined_at'),
      ),
  });
}

export function useApprovedVendors() {
  return useQuery({
    queryKey: [SCRATCH_KEY, 'approved-vendors'],
    queryFn: async () =>
      must<VendorRef[]>(
        await db()
          .from('vendors')
          .select('id, business_name, status')
          .eq('status', 'approved')
          .order('business_name'),
      ),
  });
}

export function useWinners(campaignId: number) {
  return useQuery({
    queryKey: [SCRATCH_KEY, 'winners', campaignId],
    queryFn: async () =>
      must<CampaignWinner[]>(await db().rpc('campaign_winners', { p_campaign_id: campaignId })).map((w) => ({
        ...w,
        customer_wins: Number(w.customer_wins),
      })),
  });
}

export function useStats(campaignId: number) {
  return useQuery({
    queryKey: [SCRATCH_KEY, 'stats', campaignId],
    queryFn: async () =>
      must<CampaignPrizeStats[]>(await db().rpc('campaign_stats', { p_campaign_id: campaignId })).map(
        (s) => ({
          ...s,
          given_out: Number(s.given_out),
          won: Number(s.won),
          claimed: Number(s.claimed),
          unclaimed: Number(s.unclaimed),
          expired: Number(s.expired),
          plays_total: Number(s.plays_total),
          players: Number(s.players),
        }),
      ),
  });
}

// Writes -----------------------------------------------------------------------------------------------

export type CampaignInput = Pick<
  ScratchCampaign,
  | 'name'
  | 'description'
  | 'banner_key'
  | 'starts_on'
  | 'ends_on'
  | 'active_from'
  | 'active_to'
  | 'location_id'
  | 'max_wins_per_customer'
  | 'claim_valid_days'
  | 'is_active'
>;

/** Inserts or updates a campaign and returns its id. */
export async function saveCampaign(id: number | null, row: CampaignInput) {
  if (id != null) {
    must(await db().from('scratch_campaigns').update(row).eq('id', id));
    return id;
  }
  return must<{ id: number }>(await db().from('scratch_campaigns').insert(row).select('id').single()).id;
}

export async function deleteCampaign(id: number) {
  must(await db().from('scratch_campaigns').delete().eq('id', id));
}

export type PrizeInput = Pick<
  ScratchPrize,
  'sponsor_vendor_id' | 'name' | 'description' | 'image_key' | 'quantity' | 'probability' | 'is_active'
> & { remaining?: number };

export async function savePrize(campaignId: number, id: number | null, row: PrizeInput) {
  if (id != null) {
    must(await db().from('scratch_prizes').update(row).eq('id', id));
    return;
  }
  // remaining is set from quantity by the database on insert
  must(
    await db().from('scratch_prizes').insert({
      campaign_id: campaignId,
      sponsor_vendor_id: row.sponsor_vendor_id,
      name: row.name,
      description: row.description,
      image_key: row.image_key,
      quantity: row.quantity,
      probability: row.probability,
      is_active: row.is_active,
    }),
  );
}

export async function updatePrize(
  id: number,
  patch: Partial<Pick<ScratchPrize, 'is_active' | 'probability'>>,
) {
  must(await db().from('scratch_prizes').update(patch).eq('id', id));
}

export async function deletePrize(id: number) {
  must(await db().from('scratch_prizes').delete().eq('id', id));
}

export async function addCampaignVendor(campaignId: number, vendorId: number) {
  must(await db().from('campaign_vendors').insert({ campaign_id: campaignId, vendor_id: vendorId }));
}

export async function removeCampaignVendor(campaignId: number, vendorId: number) {
  must(await db().from('campaign_vendors').delete().eq('campaign_id', campaignId).eq('vendor_id', vendorId));
}

/** Managers may only change the fraud flag and note on a play. */
export async function setFraudFlag(playId: number, flag: boolean, note: string | null) {
  must(await db().from('scratch_plays').update({ fraud_flag: flag, fraud_note: note }).eq('id', playId));
}

/** Hands an IWILLFLY (unsponsored) prize over: marks the claim code as claimed. */
export async function confirmClaim(code: string) {
  return must<ClaimLookup>(await db().rpc('claim_prize', { p_code: code, p_confirm: true }));
}

/** Postgres errors in words a campaign manager can act on. */
export function scratchError(err: unknown, inUse: string) {
  const msg = err instanceof Error ? err.message : String(err);
  if (/foreign key/i.test(msg)) return inUse;
  if (/duplicate key|unique constraint/i.test(msg)) return 'That is already added.';
  if (/active_to|active_from/i.test(msg)) return 'The daily end time must be after the start time.';
  if (/ends_on|starts_on/i.test(msg)) return 'The end date cannot be before the start date.';
  if (/remaining/i.test(msg)) return 'Stock left cannot be more than the quantity.';
  if (/violates check constraint/i.test(msg)) return 'Some values are too long or out of range.';
  return msg;
}
