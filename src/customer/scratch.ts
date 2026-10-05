import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { db, must } from '../lib/queries';
import { formatTime, usePlayScratch } from '../lib/scratch';
import { supabase } from '../lib/supabase';
import type { PlayResult, ScratchPrize, TodayCampaign } from '../lib/types';

export type PublicPrize = Pick<
  ScratchPrize,
  'id' | 'name' | 'description' | 'image_key' | 'remaining' | 'quantity'
>;

/** Live prizes of a campaign ("prizes you can win"). RLS returns only live ones. */
export function useCampaignPrizes(campaignId: number | undefined) {
  return useQuery({
    queryKey: ['scratch_prizes', campaignId],
    queryFn: async () =>
      must<PublicPrize[]>(
        await db()
          .from('scratch_prizes')
          .select('id,name,description,image_key,remaining,quantity')
          .eq('campaign_id', campaignId!)
          .order('id'),
      ),
    enabled: Boolean(supabase && campaignId),
    staleTime: 5 * 60_000,
  });
}

/** The campaign the home screen shows: the first one open now, else the first one today. */
export function pickCampaign(list: TodayCampaign[] | undefined) {
  return list?.find((c) => c.is_open_now) ?? list?.[0];
}

const IST = 'Asia/Kolkata';

/** India time now as "HH:MM:SS" and the India date as "YYYY-MM-DD". */
function istNow() {
  const now = new Date();
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(now);
  return { time, day };
}

/** "Opens 9:00 AM", "Opens tomorrow 9:00 AM" or "Closed for today" for a campaign outside its hours. */
export function closedLabel(c: TodayCampaign) {
  const { time, day } = istNow();
  if (time < c.active_from) return `Opens ${formatTime(c.active_from)}`;
  if (c.ends_on && c.ends_on <= day) return 'Closed for today';
  return `Opens tomorrow ${formatTime(c.active_from)}`;
}

/** "12 Oct 2026" in India time for a timestamp. */
export function formatDay(iso: string | null | undefined) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', {
    timeZone: IST,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * One campaign's scratch card: today's result (from the server or from scratching now), the modal state
 * and the play call. The result is fixed by play_scratch() when scratching starts, before it is shown.
 */
export function useScratchCard(campaign: TodayCampaign | undefined, loading = false) {
  const play = usePlayScratch();
  const [open, setOpenState] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [wantReveal, setWantReveal] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const fresh = play.data && play.data.campaign_id === campaign?.id ? play.data : null;
  const result: PlayResult | null = fresh ?? campaign?.today_play ?? null;

  const setOpen = (v: boolean) => {
    if (v) {
      setRevealed(Boolean(result));
      setWantReveal(false);
      if (play.isError) play.reset();
    }
    setOpenState(v);
  };

  /** The customer started scratching: ask the server for the result. */
  const start = () => {
    if (!campaign || result || play.isPending) return;
    play.mutate(campaign.id, {
      onError: () => {
        setWantReveal(false);
        setAttempt((a) => a + 1);
      },
    });
  };

  return {
    campaign,
    loading,
    result,
    open,
    setOpen,
    start,
    /** Scratched enough: show the result as soon as the server has it. */
    reveal: () => setWantReveal(true),
    revealed: revealed || (wantReveal && result != null),
    pending: play.isPending,
    error: play.error,
    /** Changes after a failed play so the scratch layer is drawn again. */
    attempt,
  };
}

export type ScratchCard = ReturnType<typeof useScratchCard>;
