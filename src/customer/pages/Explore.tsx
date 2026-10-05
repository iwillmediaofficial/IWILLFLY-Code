import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AppShell, LogoHeader } from '../../components/AppShell';
import { LocationButton } from '../../components/LocationButton';
import { EmptyState, ShopCard } from '../../components/ShopCard';
import { useToast } from '../../components/Toast';
import { usePlace } from '../../lib/location';
import { useCategories, useShopSearch } from '../../lib/queries';
import { supabase } from '../../lib/supabase';
import { ErrorNotice, Loading, NoBackend } from '../ui';

export default function Explore() {
  const [params, setParams] = useSearchParams();
  const cat = params.get('cat');
  const q = params.get('q') ?? '';
  const [text, setText] = useState(q);
  const { place, locate, locating } = usePlace();
  const toast = useToast();
  const { data: categories = [] } = useCategories();
  const shops = useShopSearch({ category: cat, q });

  // Keep the box in sync when the URL changes from elsewhere (e.g. the Home search).
  const [lastQ, setLastQ] = useState(q);
  if (q !== lastQ) {
    setLastQ(q);
    if (q !== text.trim()) setText(q);
  }

  // Debounce typing into the q URL param.
  useEffect(() => {
    if (text.trim() === q) return;
    const t = window.setTimeout(() => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (text.trim()) p.set('q', text.trim());
          else p.delete('q');
          return p;
        },
        { replace: true },
      );
    }, 300);
    return () => window.clearTimeout(t);
  }, [text, q, setParams]);

  const setCat = (slug: string | null) => {
    const p = new URLSearchParams(params);
    if (slug) p.set('cat', slug);
    else p.delete('cat');
    setParams(p, { replace: true });
  };

  const nearMe = async () => {
    if (await locate()) toast('Showing shops near you');
    else toast('Location permission was not enabled.');
  };

  return (
    <AppShell
      header={
        <LogoHeader actions={<LocationButton />}>
          <div className="searchbar">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Search shops, categories or offers..."
              enterKeyHint="search"
            />
          </div>
        </LogoHeader>
      }
    >
      <div className="section-head">
        <h2>Explore offers</h2>
        <button onClick={nearMe} disabled={locating}>
          {locating ? 'Locating…' : '📍 Near you'}
        </button>
      </div>
      <div className="filter-bar">
        <button className={`chip${!cat ? ' active' : ''}`} onClick={() => setCat(null)}>
          All
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            className={`chip${cat === c.slug ? ' active' : ''}`}
            onClick={() => setCat(c.slug)}
          >
            {c.icon ? `${c.icon} ` : ''}
            {c.name}
          </button>
        ))}
      </div>
      <section className="hero">
        <h1>
          {place ? `Offers around ${place.label === 'Near you' ? 'you' : place.label}` : 'Offers around you'}
        </h1>
        <p>
          {place
            ? 'Shops are sorted by distance so you can quickly discover nearby live deals.'
            : 'Set your location to see the nearest shops and live deals first.'}
        </p>
        <span className="hero-pill">{place ? `📍 ${place.label}` : 'Location not set'}</span>
      </section>
      <section className="section">
        <div className="section-head">
          <h2>{q ? `Results for “${q}”` : 'Recommended shops'}</h2>
          <Link to="/malls">Malls</Link>
        </div>
        {!supabase ? (
          <NoBackend />
        ) : shops.isLoading ? (
          <Loading text="Finding shops…" />
        ) : shops.error ? (
          <ErrorNotice error={shops.error} onRetry={() => shops.refetch()} />
        ) : (
          <div className="list">
            {shops.data?.length ? (
              shops.data.map((s) => <ShopCard key={s.shop_id} shop={s} />)
            ) : (
              <EmptyState
                emoji="🔎"
                title={q || cat ? 'No matching shops' : 'No shops yet'}
                text={
                  q || cat
                    ? 'Try another category or search term.'
                    : 'Offers from local shops will appear here soon.'
                }
              />
            )}
          </div>
        )}
      </section>
    </AppShell>
  );
}
