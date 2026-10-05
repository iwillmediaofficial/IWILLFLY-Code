import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useAuth } from '../auth/AuthProvider';
import { db, must } from './queries';
import type { PlayResponse, PlayResult, TodayCampaign } from './types';

/** Active campaigns today, with the signed-in customer's play if they already scratched. */
export function useScratchToday() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['scratch_today', session?.user.id ?? null],
    queryFn: async () => must<TodayCampaign[]>(await db().rpc('scratch_today')),
    enabled: Boolean(supabase),
    refetchInterval: 5 * 60_000,
  });
}

export function usePlayScratch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (campaignId: number) =>
      must<PlayResponse>(await db().rpc('play_scratch', { p_campaign_id: campaignId })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scratch_today'] });
      qc.invalidateQueries({ queryKey: ['my_prizes'] });
    },
  });
}

/** The signed-in customer's wins, newest first. */
export function useMyPrizes() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['my_prizes', session?.user.id ?? null],
    queryFn: async () => must<PlayResult[]>(await db().rpc('my_prizes')),
    enabled: Boolean(supabase && session),
  });
}

/** "09:00:00" -> "9:00 AM" */
export function formatTime(t: string) {
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Claim codes are shown as "ABCD-EFGH". */
export function formatCode(code: string) {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
