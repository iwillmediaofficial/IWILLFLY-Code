import { Link, useNavigate } from 'react-router-dom';
import { AppShell, LogoHeader } from '../../components/AppShell';
import { AdSlider } from '../../components/AdSlider';
import { LocationButton } from '../../components/LocationButton';
import { PrizeGrid, ScratchButton, ScratchModal, useDailyScratch } from '../../components/Scratch';

const categories = [
  ['👗', 'Fashion', '/explore?cat=textile'],
  ['🛋️', 'Home', '/explore?cat=appliance'],
  ['🎧', 'Electronics', '/explore?cat=electronics'],
  ['🛒', 'Grocery', '/explore?cat=supermarket'],
  ['💄', 'Beauty', '/explore?cat=beauty'],
  ['🍽️', 'Food', '/explore?cat=food'],
  ['🏬', 'Malls', '/malls'],
  ['•••', 'More', '/explore'],
];

const nearOffers = [
  {
    id: 'lulu',
    color: 'pink',
    badge: '50% OFF',
    icon: '👗',
    name: 'Lulu Fashion',
    meta: '0.8 km · Textiles',
  },
  {
    id: 'fresh',
    color: 'green',
    badge: '25% OFF',
    icon: '🛒',
    name: 'Fresh Mart',
    meta: '1.4 km · Supermarket',
  },
  {
    id: 'bismi',
    color: 'orange',
    badge: 'FESTIVE',
    icon: '📺',
    name: 'Bismi Home Appliances',
    meta: '1.2 km · Appliances',
  },
];

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
        <div className="category-grid">
          {categories.map(([icon, label, to]) => (
            <Link key={label} className="cat" to={to}>
              <div className="ico">{icon}</div>
              <span>{label}</span>
            </Link>
          ))}
        </div>
      </section>
      <section className="section">
        <div className="section-head">
          <h2>Offers near you</h2>
          <Link to="/explore">See all</Link>
        </div>
        <div className="offer-row">
          {nearOffers.map((o) => (
            <article key={o.id} className="offer-card" onClick={() => navigate(`/shop/${o.id}`)}>
              <div className={`offer-image ${o.color}`}>
                <span className="badge">{o.badge}</span>
                <b>{o.icon}</b>
              </div>
              <div className="offer-body">
                <h4>{o.name}</h4>
                <div className="meta">{o.meta}</div>
                <div className="offer-cta">
                  <strong>View offer</strong>
                  <span>→</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="section">
        <div className="section-head">
          <h2>Main shopping destinations</h2>
          <Link to="/malls">See all</Link>
        </div>
        <div className="list">
          <Link className="shop-card" to="/malls">
            <div className="shop-thumb">🏬</div>
            <div>
              <h4>Grand Mall</h4>
              <div className="meta">Fashion · Food · Electronics</div>
              <span className="offer">20+ live offers</span>
            </div>
            <div className="chev">›</div>
          </Link>
          <Link className="shop-card" to="/malls">
            <div className="shop-thumb">🏢</div>
            <div>
              <h4>City Centre</h4>
              <div className="meta">Home · Beauty · Lifestyle</div>
              <span className="offer">15+ live offers</span>
            </div>
            <div className="chev">›</div>
          </Link>
        </div>
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
