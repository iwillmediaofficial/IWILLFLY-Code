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

/** A prize with the branches it is collected at (empty when it is for all branches). */
export type BranchPrize = ScratchPrize & { branch_ids: number[] };

type PrizeRow = ScratchPrize & { scratch_prize_branches: { branch_id: number }[] | null };

/**
 * Prizes this vendor sponsors: in one campaign, or (campaignId null) every campaign. Branch members get
 * the prizes collected at their branch only.
 */
export function useMyPrizes(campaignId: number | null) {
  const vendor = useVendor();
  const branchId = vendor.my_branch_id ?? null;
  return useQuery({
    queryKey: ['vendor-scratch', 'prizes', vendor.id, campaignId, branchId],
    queryFn: async () => {
      let q = db()
        .from('scratch_prizes')
        .select('*, scratch_prize_branches(branch_id)')
        .eq('sponsor_vendor_id', vendor.id);
      if (campaignId != null) q = q.eq('campaign_id', campaignId);
      const rows = must<PrizeRow[]>(await q.order('id'));
      return rows
        .map(({ scratch_prize_branches, ...p }): BranchPrize => ({
          ...p,
          branch_ids: (scratch_prize_branches ?? []).map((b) => b.branch_id),
        }))
        .filter((p) => branchId == null || p.all_branches || p.branch_ids.includes(branchId));
    },
  });
}

export interface PrizeInput {
  name: string;
  description: string | null;
  image_key: string | null;
  quantity: number;
}

/** Where a prize is collected; null = leave it as it is (branch managers: always their branch). */
export type PrizeWhere = { all: boolean; branchIds: number[] } | null;

/**
 * Adds a prize (it starts switched off, IWILLFLY reviews it) or edits one of the vendor's own, then sets
 * its branches. A branch manager's new prize is linked to their branch by the database.
 */
export function useSavePrize(campaignId: number) {
  const vendor = useVendor();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input, where }: { id: number | null; input: PrizeInput; where: PrizeWhere }) => {
      const row = must<{ id: number }>(
        await (id == null
          ? db()
              .from('scratch_prizes')
              .insert({ ...input, campaign_id: campaignId, sponsor_vendor_id: vendor.id })
          : db().from('scratch_prizes').update(input).eq('id', id)
        )
          .select('id')
          .single(),
      );
      if (where) {
        const res = await db().rpc('set_prize_branches', {
          p_prize_id: row.id,
          p_all: where.all,
          p_branch_ids: where.all ? [] : where.branchIds,
        });
        if (res.error) {
          // A new prize stays for all branches (and switched off) until the branches are fixed.
          throw new Error(
            id == null
              ? `The prize was added for all branches, but its branches could not be set: ${res.error.message}`
              : res.error.message,
          );
        }
      }
      return row.id;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: SCRATCH_KEY }),
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
