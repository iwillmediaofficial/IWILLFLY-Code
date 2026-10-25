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
import { mediaUrl, supabase } from '../../lib/supabase';
import { FestivalBanners } from '../FestivalBanner';
import { OfferTile } from '../OfferTile';
import { ErrorNotice, Loading, NoBackend, Thumb } from '../ui';
import {
  pickCampaign,
  useCampaignPrizes,
  useScratchCard,
  type PublicPrize,
  type ScratchCard,
} from '../scratch';
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
      <section className="sw-panel">
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

/** The two cards next to the scratch button: open/closed with hours, and today's prizes. */
function ScratchStatus({ card }: { card: ScratchCard }) {
  const c = card.campaign;
  const prizes = useCampaignPrizes(c?.id);
  const live = prizes.data?.filter((p) => p.remaining > 0) ?? [];
  const open = Boolean(c?.is_open_now);
  return (
    <div className="sw-side">
      <div className={`sw-card sw-hours${open ? '' : ' closed'}`}>
        <div className="h-row">
          <div className="sw-clock">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#17243f"
              strokeWidth="2.4"
              strokeLinecap="round"
              aria-hidden
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          </div>
          <div className="h-title">
            <span className="light" />
            <span>
              {c ? (open ? 'Open Now' : 'Closed Now') : card.loading ? 'Loading…' : 'No Game Today'}
            </span>
          </div>
        </div>
        <div className="h-time">
          {c ? (
            <>
              <span>{formatTime(c.active_from)} –</span> <span>{formatTime(c.active_to)}</span>
            </>
          ) : (
            'Check back soon'
          )}
        </div>
      </div>
      <PrizeSlider key={live.length} prizes={live} empty={c ? 'Coming soon' : '—'} />
    </div>
  );
}

const SLIDE_MS = 2000;
const SWIPE_PAUSE_TICKS = 3; // auto-slide waits 3 turns (6 s) after a swipe or dot tap

/** Today's Prize card: shows each prize with stock one by one; swipe or tap a dot to move. */
function PrizeSlider({ prizes, empty }: { prizes: PublicPrize[]; empty: string }) {
  const navigate = useNavigate();
  const count = prizes.length;
  // The track ends with a copy of the first prize so the last one slides on to it, then jumps back.
  const [index, setIndex] = useState(0);
  const [animate, setAnimate] = useState(true);
  const pause = useRef(0);
  const touchX = useRef<number | null>(null);
  const swiped = useRef(false);

  useEffect(() => {
    if (count < 2) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (pause.current > 0) {
        pause.current -= 1;
        return;
      }
      setAnimate(true);
      setIndex((i) => Math.min(i + 1, count));
    }, SLIDE_MS);
    return () => window.clearInterval(id);
  }, [count]);

  // After sliding on to the copy of the first prize, jump back to the real one without a slide.
  useEffect(() => {
    if (count < 2 || index !== count) return;
    const id = window.setTimeout(() => {
      setAnimate(false);
      setIndex(0);
    }, 450);
    return () => window.clearTimeout(id);
  }, [index, count]);

  // Turn the slide back on once the jump has been drawn.
  useEffect(() => {
    if (animate) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setAnimate(true)));
    return () => cancelAnimationFrame(id);
  }, [animate]);

  function go(to: number) {
    pause.current = SWIPE_PAUSE_TICKS;
    setAnimate(true);
    setIndex(((to % count) + count) % count);
  }

  const current = count ? index % count : 0;
  const slides = count > 1 ? [...prizes, prizes[0]] : prizes;

  return (
    <div
      className="sw-card sw-prize"
      role={count ? 'link' : undefined}
      onClick={() => {
        if (swiped.current) swiped.current = false;
        else if (count) navigate('/scratch');
      }}
    >
      <div className="p-head">Today’s Prize</div>
      {count === 0 ? (
        <div className="p-body">
          <div className="p-img">🎁</div>
          <div className="p-name">{empty}</div>
        </div>
      ) : (
        <div
          className="p-slider"
          onTouchStart={(e) => {
            touchX.current = e.touches[0].clientX;
            swiped.current = false;
          }}
          onTouchEnd={(e) => {
            if (touchX.current === null || count < 2) return;
            const dx = e.changedTouches[0].clientX - touchX.current;
            touchX.current = null;
            if (Math.abs(dx) < 30) return;
            swiped.current = true;
            go(current + (dx < 0 ? 1 : -1));
          }}
        >
          <div
            className={`p-track${animate ? '' : ' still'}`}
            style={{ transform: `translateX(-${index * 100}%)` }}
          >
            {slides.map((p, i) => (
              <div className={`p-body${i === index ? ' on' : ''}`} key={i} aria-hidden={i !== index}>
                <div className="p-img">
                  {p.image_key ? (
                    <img src={mediaUrl(p.image_key)} alt="" decoding="async" width={64} height={64} />
                  ) : (
                    '🎁'
                  )}
                </div>
                <div className="p-name">{p.name}</div>
              </div>
            ))}
          </div>
          {count > 1 && (
            <div className="p-dots">
              {prizes.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  className={i === current ? 'on' : ''}
                  aria-label={`Prize ${i + 1} of ${count}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    go(i);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
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
          shopPath={`/shop/${o.shop_slug}${o.branch_slug ? `/${o.branch_slug}` : ''}`}
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
          title={
            o.branch_name && o.branch_name !== 'Main branch'
              ? `${o.shop_name} · ${o.branch_name}`
              : o.shop_name
          }
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
