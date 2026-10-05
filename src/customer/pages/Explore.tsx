import { Link, useSearchParams } from 'react-router-dom';
import { AppShell, LogoHeader } from '../../components/AppShell';
import { LocationButton } from '../../components/LocationButton';
import { EmptyState, ShopCard } from '../../components/ShopCard';
import { filters, shops, type CategoryKey } from '../../data/demo';

export default function Explore() {
  const [params, setParams] = useSearchParams();
  const cat = (params.get('cat') ?? 'all') as 'all' | CategoryKey;
  const q = params.get('q') ?? '';

  const update = (next: { cat?: string; q?: string }) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v && v !== 'all') p.set(k, v);
      else p.delete(k);
    }
    setParams(p, { replace: true });
  };

  const list = shops.filter(
    (s) =>
      (cat === 'all' || s.cat === cat) &&
      (!q || `${s.name} ${s.cat} ${s.offer}`.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <AppShell
      header={
        <LogoHeader actions={<LocationButton />}>
          <div className="searchbar">
            <input
              value={q}
              onChange={(e) => update({ q: e.target.value })}
              placeholder="Search shops, categories or offers..."
            />
          </div>
        </LogoHeader>
      }
    >
      <div className="section-head">
        <h2>Explore offers</h2>
        <button>📍 Near you</button>
      </div>
      <div className="filter-bar">
        {filters.map((f) => (
          <button
            key={f.key}
            className={`chip${cat === f.key ? ' active' : ''}`}
            onClick={() => update({ cat: f.key })}
          >
            {f.label}
          </button>
        ))}
      </div>
      <section className="hero">
        <h1>Offers around you</h1>
        <p>
          Location-based results are sorted by distance so customers can quickly discover nearby live deals.
        </p>
        <span className="hero-pill">Location experience enabled</span>
      </section>
      <section className="section">
        <div className="section-head">
          <h2>Recommended shops</h2>
          <Link to="/malls">Malls</Link>
        </div>
        <div className="list">
          {list.length ? (
            list.map((s) => <ShopCard key={s.id} shop={s} />)
          ) : (
            <EmptyState emoji="🔎" title="No matching shops" text="Try another category or search term." />
          )}
        </div>
      </section>
    </AppShell>
  );
}
