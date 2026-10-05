import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { db, must } from '../../lib/queries';
import type { ClaimLookup, ScratchCampaign, ScratchPrize, VendorWinner } from '../../lib/types';
import { useVendor } from '../context';

// Every vendor Scratch & Win query key starts with 'vendor-scratch', so one save can refresh them all.
export const SCRATCH_KEY = ['vendor-scratch'] as const;

/** Campaigns this vendor can see: running ones plus any they joined (RLS decides), newest first. */
export function useScratchCampaigns() {
  const vendor = useVendor();
  return useQuery({
    queryKey: ['vendor-scratch', 'campaigns', vendor.id],
    queryFn: async () =>
      must<ScratchCampaign[]>(
        await db()
          .from('scratch_campaigns')
          .select('*')
          .order('starts_on', { ascending: false })
          .order('id', { ascending: false }),
      ),
  });
}

/** Ids of the campaigns this vendor has joined. */
export function useJoinedCampaignIds() {
  const vendor = useVendor();
  return useQuery({
    queryKey: ['vendor-scratch', 'joined', vendor.id],
    queryFn: async () =>
      must<{ campaign_id: number }[]>(
        await db().from('campaign_vendors').select('campaign_id').eq('vendor_id', vendor.id),
      ).map((r) => r.campaign_id),
  });
}

/** Campaigns split into the ones joined and the running ones still open to join. */
export function useCampaignLists() {
  const campaigns = useScratchCampaigns();
  const joined = useJoinedCampaignIds();
  const ids = new Set(joined.data ?? []);
  const all = campaigns.data ?? [];
  return {
    all,
    joinedIds: ids,
    joined: all.filter((c) => ids.has(c.id)),
    available: all.filter((c) => c.is_active && !ids.has(c.id)),
    isPending: campaigns.isPending || joined.isPending,
    error: campaigns.error ?? joined.error,
  };
}

export function useJoinCampaign() {
  const vendor = useVendor();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ campaignId, join }: { campaignId: number; join: boolean }) =>
      join
        ? must(await db().from('campaign_vendors').insert({ campaign_id: campaignId, vendor_id: vendor.id }))
        : must(
            await db()
              .from('campaign_vendors')
              .delete()
              .eq('campaign_id', campaignId)
              .eq('vendor_id', vendor.id),
          ),
    onSuccess: () => qc.invalidateQueries({ queryKey: SCRATCH_KEY }),
  });
}

/** Prizes this vendor sponsors in one campaign. */
export function useMyPrizes(campaignId: number) {
  const vendor = useVendor();
  return useQuery({
    queryKey: ['vendor-scratch', 'prizes', vendor.id, campaignId],
    queryFn: async () =>
      must<ScratchPrize[]>(
        await db()
          .from('scratch_prizes')
          .select('*')
          .eq('campaign_id', campaignId)
          .eq('sponsor_vendor_id', vendor.id)
          .order('id'),
      ),
  });
}

export interface PrizeInput {
  name: string;
  description: string | null;
  image_key: string | null;
  quantity: number;
}

/** Adds a prize (it starts switched off, IWILLFLY reviews it) or edits one of the vendor's own. */
export function useSavePrize(campaignId: number) {
  const vendor = useVendor();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: number | null; input: PrizeInput }) =>
      id == null
        ? must(
            await db()
              .from('scratch_prizes')
              .insert({ ...input, campaign_id: campaignId, sponsor_vendor_id: vendor.id }),
          )
        : must(await db().from('scratch_prizes').update(input).eq('id', id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: SCRATCH_KEY }),
  });
}

/** Winners of this vendor's prizes (names masked, no codes); null = every campaign. */
export function useVendorWinners(campaignId: number | null) {
  const vendor = useVendor();
  return useQuery({
    queryKey: ['vendor-scratch', 'winners', vendor.id, campaignId],
    queryFn: async () =>
      must<VendorWinner[]>(await db().rpc('vendor_winners', { p_campaign_id: campaignId })),
  });
}

/** Looks up a claim code, or with confirm hands the prize over. */
export function useClaimPrize() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ code, confirm }: { code: string; confirm: boolean }) =>
      must<ClaimLookup>(await db().rpc('claim_prize', { p_code: code, p_confirm: confirm })),
    onSuccess: (res) => {
      if (res.status === 'claimed_now') qc.invalidateQueries({ queryKey: SCRATCH_KEY });
    },
  });
}
