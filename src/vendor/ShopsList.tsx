import { Link } from 'react-router-dom';
import { useCategories } from '../lib/queries';
import { mediaUrl } from '../lib/supabase';
import { useMyShops } from './api';
import { useReadOnly } from './context';
import { ErrorNote, Loading, PageHead } from './ui';

export default function ShopsList() {
  const { data: shops, isPending, error } = useMyShops();
  const { data: categories = [] } = useCategories();
  const readOnly = useReadOnly();

  return (
    <>
      <PageHead title="Your shops" action={!readOnly && <Link to="/vendor/shops/new">＋ Add shop</Link>} />
      {isPending ? (
        <Loading />
      ) : error ? (
        <ErrorNote error={error} />
      ) : shops.length === 0 ? (
        <div className="saved-empty">
          <div className="emoji">🏪</div>
          <h3>No shops yet</h3>
          <p>Add your shop, then its branches and offers.</p>
          {!readOnly && (
            <Link className="btn" to="/vendor/shops/new" style={{ display: 'inline-block', marginTop: 8 }}>
              Add your first shop
            </Link>
          )}
        </div>
      ) : (
        <div className="list">
          {shops.map((s) => {
            const cat = categories.find((c) => c.id === s.category_id);
            return (
              <Link key={s.id} className="shop-card" to={`/vendor/shops/${s.id}`}>
                <div className="shop-thumb">
                  {s.logo_key ? <img src={mediaUrl(s.logo_key)} alt="" /> : '🏪'}
                </div>
                <div>
                  <h4>{s.name}</h4>
                  <div className="meta">{cat ? `${cat.icon ?? ''} ${cat.name}` : 'No category'}</div>
                  <span className={`pill-status${s.is_active ? ' live' : ''}`} style={{ marginTop: 6 }}>
                    {s.is_active ? 'Active' : 'Hidden'}
                  </span>
                </div>
                <div className="chev">›</div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
