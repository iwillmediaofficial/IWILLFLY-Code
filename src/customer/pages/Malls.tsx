import { AppShell, BackHeader } from '../../components/AppShell';
import { ShopCard } from '../../components/ShopCard';
import { shops } from '../../data/demo';

export default function Malls() {
  return (
    <AppShell
      header={
        <BackHeader
          back="/explore"
          title="Malls & Shopping Centres"
          subtitle="Shops grouped inside each mall"
          actions={<button className="icon-btn">⌕</button>}
        />
      }
    >
      <section className="hero">
        <h1>Grand Mall</h1>
        <p>
          Fashion, electronics, home appliances, food and more — all offers from shops inside the mall in one
          place.
        </p>
        <span className="hero-pill">20+ live offers</span>
      </section>
      <section className="section">
        <div className="section-head">
          <h2>Shops inside malls</h2>
          <button>Nearest first</button>
        </div>
        <div className="list">
          {shops
            .filter((s) => s.mall)
            .slice(0, 6)
            .map((s) => (
              <ShopCard key={s.id} shop={s} showStatus={false} />
            ))}
        </div>
      </section>
      <section className="section">
        <div className="section-head">
          <h2>Other malls</h2>
        </div>
        <div className="list">
          <div className="shop-card">
            <div className="shop-thumb">🏢</div>
            <div>
              <h4>City Centre</h4>
              <div className="meta">1.7 km · 15 shops</div>
              <span className="offer">12 live offers</span>
            </div>
            <div className="chev">›</div>
          </div>
          <div className="shop-card">
            <div className="shop-thumb">🏬</div>
            <div>
              <h4>Metro Mall</h4>
              <div className="meta">2.4 km · 22 shops</div>
              <span className="offer">17 live offers</span>
            </div>
            <div className="chev">›</div>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
