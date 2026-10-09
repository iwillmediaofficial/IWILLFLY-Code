import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppShell, LogoHeader, NotificationBell } from '../../components/AppShell';
import { AdSlider } from '../../components/AdSlider';
import { CategoryIcon } from '../../components/CategoryIcon';
import { LegalLinks } from '../../components/LegalLinks';
import { LocationButton } from '../../components/LocationButton';
import { CampaignPrizes, ScratchButton, ScratchModal } from '../../components/Scratch';
import { EmptyState } from '../../components/ShopCard';
import { formatKm } from '../../lib/hours';
import { isApprox, usePlace } from '../../lib/location';
import { useCategories, useMalls, useOfferSearch } from '../../lib/queries';
import { formatTime, useScratchToday } from '../../lib/scratch';
import { supabase } from '../../lib/supabase';
import { FestivalBanners } from '../FestivalBanner';
import { OfferTile } from '../OfferTile';
import { ErrorNotice, Loading, NoBackend, Thumb } from '../ui';
import { pickCampaign, useCampaignPrizes, useScratchCard, type ScratchCard } from '../scratch';
import { toneFor } from '../util';

export default function Home() {
  const today = useScratchToday();
  const card = useScratchCard(pickCampaign(today.data), today.isLoading);
  const navigate = useNavigate();
  return (
    <AppShell
      header={
        <LogoHeader
          actions={
            <>
              <LocationButton />
              <NotificationBell />
            </>
          }
        >
          <form
            className="searchbar"
            onSubmit={(e) => {
              e.preventDefault();
              const q = new FormData(e.currentTarget).get('q');
              navigate(`/explore?q=${encodeURIComponent(String(q ?? ''))}`);
            }}
          >
            <input name="q" placeholder="Search shops, products or offers..." />
          </form>
        </LogoHeader>
      }
    >
      <AdSlider />
      <FestivalBanners />
      <section className="scratch-panel">
        <ScratchButton card={card} />
        <ScratchStatus card={card} />
      </section>
      <section className="section">
        <div className="section-head">
          <h2>Browse by product</h2>
          <Link to="/explore">View all</Link>
        </div>
        <CategoryGrid />
      </section>
      <section className="section">
        <div className="section-head">
          <h2>Offers near you</h2>
          <Link to="/explore">See all</Link>
        </div>
        <NearOffers />
      </section>
      <section className="section">
        <div className="section-head">
          <h2>Main shopping destinations</h2>
          <Link to="/malls">See all</Link>
        </div>
        <TopMalls />
      </section>
      <LegalLinks />
      <ScratchModal card={card} title="Daily Scratch & Win" subtitle="One chance every day">
        <h3>Possible prizes today</h3>
        <CampaignPrizes campaignId={card.campaign?.id} />
      </ScratchModal>
    </AppShell>
  );
}

/** The small card next to the scratch button: open/closed, hours and a highlighted prize. */
function ScratchStatus({ card }: { card: ScratchCard }) {
  const c = card.campaign;
  const prizes = useCampaignPrizes(c?.id);
  const highlight = prizes.data?.find((p) => p.remaining > 0);
  const open = Boolean(c?.is_open_now);
  return (
    <div className="status-card">
      <div className={`status ${open ? 'open' : 'closed'}`}>
        <span className="light" />
        <b>{c ? (open ? 'Open Now' : 'Closed Now') : card.loading ? 'Loading…' : 'No Game Today'}</b>
      </div>
      <div className="meta" style={{ marginTop: 4 }}>
        {c ? `${formatTime(c.active_from)} – ${formatTime(c.active_to)}` : 'Check back soon'}
      </div>
      <div className="prize-mini">
        Today’s highlighted prize
        <strong>{highlight ? `🎁 ${highlight.name}` : c ? 'Coming soon' : '—'}</strong>
      </div>
    </div>
  );
}

/** One row of category tiles that scrolls sideways; the arrow scrolls on and hides at the end. */
function CategoryGrid() {
  const { data, isLoading } = useCategories();
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);

  const update = useCallback(() => {
    const el = scroller.current;
    if (el) setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [update, data]);

  if (!supabase) return <NoBackend />;
  if (isLoading) return <Loading />;
  const tiles = [
    ...(data ?? []).map((c) => ({
      key: c.slug,
      icon: (<CategoryIcon category={c} fill />) as ReactNode,
      label: c.name,
      to: `/explore?cat=${encodeURIComponent(c.slug)}`,
    })),
    { key: 'malls', icon: '🏬' as ReactNode, label: 'Malls', to: '/malls' },
  ];
  return (
    <div className="cat-row">
      <div className="cat-row-scroll" ref={scroller} onScroll={update}>
        {tiles.map((t) => (
          <Link key={t.key} className="cat-tile" to={t.to}>
            <div className="cat-tile-ico">{t.icon}</div>
            <span>{t.label}</span>
          </Link>
        ))}
      </div>
      {more && (
        <button
          type="button"
          className="cat-row-next"
          aria-label="More categories"
          onClick={() =>
            scroller.current?.scrollBy({ left: scroller.current.clientWidth * 0.8, behavior: 'smooth' })
          }
        >
          ›
        </button>
      )}
    </div>
  );
}

function NearOffers() {
  const approx = isApprox(usePlace().place);
  const { data, isLoading, error, refetch } = useOfferSearch({ limit: 10 });
  if (!supabase) return null;
  if (isLoading) return <Loading text="Finding offers near you…" />;
  if (error) return <ErrorNotice error={error} onRetry={() => refetch()} />;
  if (!data?.length) {
    return (
      <EmptyState emoji="🛍️" title="No offers yet" text="Offers from local shops will appear here soon." />
    );
  }
  return (
    <div className="offer-row">
      {data.map((o, i) => (
        <OfferTile
          key={o.offer_id}
          shopId={o.shop_id}
          offerId={o.offer_id}
          imageKey={o.image_key}
          icon={
            <CategoryIcon
              category={{ slug: o.category_slug, icon: o.category_icon }}
              fallback="🎁"
              size={56}
            />
          }
          badge={o.discount_label ?? (o.is_featured ? 'FEATURED' : 'OFFER')}
          tone={toneFor(i)}
          title={o.shop_name}
          meta={[formatKm(o.distance_km, approx), o.title].filter(Boolean).join(' · ')}
        />
      ))}
    </div>
  );
}

function TopMalls() {
  const approx = isApprox(usePlace().place);
  const { data, isLoading, error, refetch } = useMalls();
  if (!supabase) return null;
  if (isLoading) return <Loading />;
  if (error) return <ErrorNotice error={error} onRetry={() => refetch()} />;
  if (!data?.length) {
    return (
      <EmptyState
        emoji="🏬"
        title="No malls yet"
        text="Shopping destinations near you will appear here soon."
      />
    );
  }
  return (
    <div className="list">
      {data.slice(0, 2).map((m) => (
        <Link key={m.mall_id} className="shop-card" to={`/mall/${m.mall_id}`}>
          <Thumb imageKey={m.cover_key} icon="🏬" />
          <div>
            <h4>{m.name}</h4>
            <div className="meta">
              {[formatKm(m.distance_km, approx), `${m.shop_count} ${m.shop_count === 1 ? 'shop' : 'shops'}`]
                .filter(Boolean)
                .join(' · ')}
            </div>
            <span className="offer">
              {m.offer_count} live {m.offer_count === 1 ? 'offer' : 'offers'}
            </span>
          </div>
          <div className="chev">›</div>
        </Link>
      ))}
    </div>
  );
}
