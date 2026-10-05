import { Link, useNavigate } from 'react-router-dom';
import { AppShell, LogoHeader } from '../../components/AppShell';
import { AdSlider } from '../../components/AdSlider';
import { LocationButton } from '../../components/LocationButton';
import { PrizeGrid, ScratchButton, ScratchModal, useDailyScratch } from '../../components/Scratch';
import { EmptyState } from '../../components/ShopCard';
import { formatKm } from '../../lib/hours';
import { useCategories, useMalls, useOfferSearch } from '../../lib/queries';
import { supabase } from '../../lib/supabase';
import { ErrorNotice, Loading, NoBackend, OfferImage, Thumb } from '../ui';
import { toneFor } from '../util';

export default function Home() {
  const daily = useDailyScratch();
  const navigate = useNavigate();
  return (
    <AppShell
      header={
        <LogoHeader
          actions={
            <>
              <LocationButton />
              <button className="icon-btn">🔔</button>
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
      <section className="scratch-panel">
        <ScratchButton daily={daily} />
        <div className="status-card">
          <div className="status open">
            <span className="light" />
            <b>Shop Open</b>
          </div>
          <div className="meta" style={{ marginTop: 4 }}>
            9:00 AM – 10:00 PM
          </div>
          <div className="prize-mini">
            Today’s highlighted prize<strong>🎧 Wireless Earbuds</strong>
          </div>
        </div>
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
      <ScratchModal daily={daily} title="Daily Scratch & Win" subtitle="One chance every day">
        <h3>Possible prizes today</h3>
        <PrizeGrid
          items={[
            ['📱', 'Smart Phone'],
            ['💻', 'Laptop'],
            ['🎧', 'Earbuds'],
            ['⌚', 'Smart Watch'],
            ['🎫', 'Vouchers'],
            ['🎁', 'Mystery Gift'],
          ]}
        />
      </ScratchModal>
    </AppShell>
  );
}

function CategoryGrid() {
  const { data, isLoading } = useCategories();
  if (!supabase) return <NoBackend />;
  const tiles = [
    ...(data ?? []).slice(0, 6).map((c) => ({
      icon: c.icon ?? '🏷️',
      label: c.name,
      to: `/explore?cat=${encodeURIComponent(c.slug)}`,
    })),
    { icon: '🏬', label: 'Malls', to: '/malls' },
    { icon: '•••', label: 'More', to: '/explore' },
  ];
  if (isLoading) return <Loading />;
  return (
    <div className="category-grid">
      {tiles.map((t) => (
        <Link key={t.to} className="cat" to={t.to}>
          <div className="ico">{t.icon}</div>
          <span>{t.label}</span>
        </Link>
      ))}
    </div>
  );
}

function NearOffers() {
  const navigate = useNavigate();
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
        <article
          key={o.offer_id}
          className="offer-card"
          onClick={() => navigate(`/shop/${o.shop_id}?offer=${o.offer_id}`)}
        >
          <OfferImage
            imageKey={o.image_key}
            icon={o.category_icon}
            badge={o.discount_label ?? (o.is_featured ? 'FEATURED' : 'OFFER')}
            tone={toneFor(i)}
          />
          <div className="offer-body">
            <h4>{o.shop_name}</h4>
            <div className="meta">{[formatKm(o.distance_km), o.title].filter(Boolean).join(' · ')}</div>
            <div className="offer-cta">
              <strong>View offer</strong>
              <span>→</span>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function TopMalls() {
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
              {[formatKm(m.distance_km), `${m.shop_count} ${m.shop_count === 1 ? 'shop' : 'shops'}`]
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
