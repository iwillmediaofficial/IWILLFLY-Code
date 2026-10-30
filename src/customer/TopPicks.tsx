import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { CategoryIcon } from '../components/CategoryIcon';
import { usePlace } from '../lib/location';
import { db, must, useBranchParking } from '../lib/queries';
import { supabase } from '../lib/supabase';
import { OfferTile } from './OfferTile';
import { toneFor } from './util';
import { Gift } from 'lucide-react';

interface TopPick {
  top_pick_id: number;
  offer_id: number;
  title: string;
  discount_label: string | null;
  image_key: string | null;
  shop_id: number;
  shop_name: string;
  shop_slug: string;
  branch_slug: string | null;
  branch_name: string | null;
  category_slug: string | null;
  category_icon: string | null;
  district_name: string;
}

// Views are counted once per sponsorship per app session.
const seen = new Set<number>();

function trackTopPicks(event: 'view' | 'tap', ids: number[]) {
  if (!supabase || ids.length === 0) return;
  void supabase.rpc('track_top_picks', { p_event: event, p_ids: ids }).then(
    () => undefined,
    () => undefined,
  );
}

/**
 * The sponsored "Top Picks" row on Home: paid offers for the district of the area the customer picked (or their
 * saved area), first come first shown. Hidden when there are none or no area is known.
 */
export function TopPicksSection() {
  const { place } = usePlace();
  const areaId = typeof place?.source === 'number' ? place.source : null;
  const { data } = useQuery({
    queryKey: ['top_picks_for', areaId],
    queryFn: async () => must<TopPick[]>(await db().rpc('top_picks_for', { p_area_id: areaId })),
    enabled: Boolean(supabase),
    staleTime: 60_000,
  });
  const parking = useBranchParking(data?.map((o) => o.shop_id) ?? []);

  useEffect(() => {
    const fresh = (data ?? []).map((p) => p.top_pick_id).filter((id) => !seen.has(id));
    fresh.forEach((id) => seen.add(id));
    trackTopPicks('view', fresh);
  }, [data]);

  if (!data?.length) return null;
  return (
    <section className="section">
      <div className="section-head top-picks-head">
        <h2>Top Picks</h2>
        <span className="meta">in {data[0].district_name}</span>
      </div>
      <div className="offer-row three">
        {data.map((o, i) => (
          <OfferTile
            key={o.top_pick_id}
            shopId={o.shop_id}
            offerId={o.offer_id}
            shopPath={`/shop/${o.shop_slug}${o.branch_slug ? `/${o.branch_slug}` : ''}`}
            imageKey={o.image_key}
            icon={
              <CategoryIcon
                category={{ slug: o.category_slug, icon: o.category_icon }}
                fallback={Gift}
                size={56}
              />
            }
            badge={o.discount_label ?? 'OFFER'}
            tone={toneFor(i)}
            title={
              o.branch_name && o.branch_name !== 'Main branch'
                ? `${o.shop_name} · ${o.branch_name}`
                : o.shop_name
            }
            meta={o.title}
            parking={o.branch_slug ? parking.data?.get(`${o.shop_id}/${o.branch_slug}`) : null}
            sponsored
            onOpen={() => trackTopPicks('tap', [o.top_pick_id])}
          />
        ))}
      </div>
    </section>
  );
}
