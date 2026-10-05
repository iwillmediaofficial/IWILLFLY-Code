import type { CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { nowIST } from '../lib/hours';
import { db, must } from '../lib/queries';
import { mediaUrl, supabase } from '../lib/supabase';
import type { Ad, Festival, FestivalOffer, HistoryOffer } from '../lib/types';

/** Running home-screen ads. RLS returns only active ones inside their dates. */
export function useAds() {
  return useQuery({
    queryKey: ['ads', 'running'],
    queryFn: async () => must<Ad[]>(await db().from('ads').select('*').order('sort_order').order('id')),
    enabled: Boolean(supabase),
    staleTime: 5 * 60_000,
  });
}

/** An ad's external link when it is a valid https URL. */
export function adExternalUrl(ad: Ad) {
  if (ad.link_kind !== 'url' || !ad.link_target) return null;
  try {
    const u = new URL(ad.link_target.trim());
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/** The in-app path an ad tap opens, or null when it has none. Offers look up their shop. */
export async function resolveAdPath(ad: Ad): Promise<string | null> {
  const target = ad.link_target?.trim();
  if (!target) return null;
  switch (ad.link_kind) {
    case 'shop':
      return /^\d+$/.test(target) ? `/shop/${target}` : null;
    case 'mall':
      return /^\d+$/.test(target) ? `/mall/${target}` : null;
    case 'festival':
      return `/festival/${encodeURIComponent(target)}`;
    case 'offer': {
      if (!/^\d+$/.test(target)) return null;
      const row = must<{ id: number; shop_id: number } | null>(
        await db().from('offers').select('id, shop_id').eq('id', Number(target)).maybeSingle(),
      );
      return row ? `/shop/${row.shop_id}?offer=${row.id}` : null;
    }
    default:
      return null;
  }
}

/** Active festivals (RLS) narrowed to the ones running today in India. */
export function useActiveFestivals() {
  return useQuery({
    queryKey: ['festivals', 'active'],
    queryFn: async () => {
      const rows = must<Festival[]>(
        await db().from('festivals').select('*').order('sort_order').order('starts_on'),
      );
      const today = nowIST().date;
      return rows.filter((f) => f.starts_on <= today && today <= f.ends_on);
    },
    enabled: Boolean(supabase),
    staleTime: 5 * 60_000,
  });
}

export function useFestival(slug: string | undefined) {
  return useQuery({
    queryKey: ['festival', slug],
    queryFn: async () =>
      must<Festival | null>(await db().from('festivals').select('*').eq('slug', slug!).maybeSingle()),
    enabled: Boolean(supabase && slug),
  });
}

export function useFestivalOffers(festivalId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: ['festival_offers_live', festivalId],
    queryFn: async () =>
      must<FestivalOffer[]>(await db().rpc('festival_offers_live', { p_festival_id: festivalId })),
    enabled: Boolean(supabase && festivalId && enabled),
  });
}

/** Whether a festival is running on the given India date. */
export function festivalRunning(f: Festival, today = nowIST().date) {
  return f.is_active && f.starts_on <= today && today <= f.ends_on;
}

/** "12 Oct – 20 Oct" style range. */
export function festivalDates(f: Festival) {
  const fmt = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return f.starts_on === f.ends_on ? fmt(f.starts_on) : `${fmt(f.starts_on)} – ${fmt(f.ends_on)}`;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Gradient for a festival's theme colour, or the default blue hero gradient. */
export function festivalGradient(f: Festival) {
  const c = f.theme_color && HEX.test(f.theme_color) ? f.theme_color : null;
  return c ? `linear-gradient(135deg, ${c}, ${c}b3)` : 'linear-gradient(135deg, #1466dd, #0e46aa)';
}

/** Banner background: the festival image under a dark gradient, else its theme colour. */
export function festivalBackground(f: Festival): CSSProperties {
  return f.banner_key
    ? {
        backgroundImage: `linear-gradient(135deg, rgba(0, 0, 0, 0.55), rgba(0, 0, 0, 0.25)), url(${mediaUrl(f.banner_key)})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : { background: festivalGradient(f) };
}

/** The signed-in user's recently viewed offers. */
export function useOfferHistory() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['my_offer_history', session?.user.id ?? null],
    queryFn: async () => must<HistoryOffer[]>(await db().rpc('my_offer_history', { p_limit: 30 })),
    enabled: Boolean(supabase && session),
  });
}
