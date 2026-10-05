import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppShell, BackHeader } from '../../components/AppShell';
import { EmptyState } from '../../components/ShopCard';
import { formatPrice, nowIST } from '../../lib/hours';
import { supabase } from '../../lib/supabase';
import {
  festivalBackground,
  festivalDates,
  festivalRunning,
  useFestival,
  useFestivalOffers,
} from '../engagement';
import { OfferTile } from '../OfferTile';
import { ErrorNotice, Loading, NoBackend } from '../ui';
import { toneFor, validity } from '../util';

export default function Festival() {
  const { slug } = useParams();
  const festival = useFestival(slug);
  const f = festival.data;
  const running = f ? festivalRunning(f) : false;
  const offers = useFestivalOffers(f?.id, running);

  const header = (
    <BackHeader back="/" title={f?.name ?? 'Festival'} subtitle={f ? festivalDates(f) : 'Festival offers'} />
  );
  const shell = (body: ReactNode) => <AppShell header={header}>{body}</AppShell>;

  if (!supabase) return shell(<NoBackend />);
  if (festival.isLoading) return shell(<Loading />);
  if (festival.error) return shell(<ErrorNotice error={festival.error} onRetry={() => festival.refetch()} />);
  if (!f) {
    return shell(
      <EmptyState emoji="🎉" title="Festival not found" text="This festival may no longer be on IWILLFLY.">
        <Link className="btn" to="/" style={{ display: 'inline-block', marginTop: 12 }}>
          Back to home
        </Link>
      </EmptyState>,
    );
  }

  const upcoming = !running && f.is_active && f.starts_on > nowIST().date;
  const list = offers.data ?? [];

  return shell(
    <>
      <section className="hero" style={festivalBackground(f)}>
        <h1>🎉 {f.name}</h1>
        {f.description && <p style={{ whiteSpace: 'pre-line' }}>{f.description}</p>}
        <span className="hero-pill">
          {running
            ? `${festivalDates(f)} · ${list.length} ${list.length === 1 ? 'offer' : 'offers'}`
            : upcoming
              ? `Starts ${festivalDates(f)}`
              : 'This festival has ended'}
        </span>
      </section>
      <section className="section">
        {running ? (
          <>
            <div className="section-head">
              <h2>Festival offers</h2>
              {list.length > 0 && <button>{list.length} live</button>}
            </div>
            {offers.isLoading ? (
              <Loading text="Loading festival offers…" />
            ) : offers.error ? (
              <ErrorNotice error={offers.error} onRetry={() => offers.refetch()} />
            ) : list.length ? (
              <div className="offer-grid">
                {list.map((o, i) => (
                  <OfferTile
                    key={o.offer_id}
                    shopId={o.shop_id}
                    offerId={o.offer_id}
                    imageKey={o.image_key}
                    icon="🎁"
                    badge={o.discount_label ?? (o.is_featured ? 'FEATURED' : 'OFFER')}
                    tone={toneFor(i)}
                    title={o.shop_name}
                    meta={[o.title, o.offer_price != null ? formatPrice(o.offer_price) : validity(o.ends_on)]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                emoji="🛍️"
                title="No festival offers yet"
                text="Shops are adding their festival deals. Check back soon."
              />
            )}
          </>
        ) : (
          <EmptyState
            emoji={upcoming ? '⏳' : '🎊'}
            title={upcoming ? 'Coming soon' : 'This festival has ended'}
            text={
              upcoming
                ? 'Festival offers will appear here when it starts.'
                : 'Thanks for celebrating with local shops. Explore the offers running now.'
            }
          >
            <Link className="btn" to="/explore" style={{ display: 'inline-block', marginTop: 12 }}>
              Explore offers
            </Link>
          </EmptyState>
        )}
      </section>
    </>,
  );
}
