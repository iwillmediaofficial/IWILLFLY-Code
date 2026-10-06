import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { track } from '../lib/engagement';
import { formatKm, openState } from '../lib/hours';
import { isApprox, usePlace } from '../lib/location';
import type { ShopResult } from '../lib/types';
import { Thumb } from '../customer/ui';

export function ShopCard({ shop, showStatus = true }: { shop: ShopResult; showStatus?: boolean }) {
  const state = shop.branch_id != null ? openState(shop) : null;
  const approx = isApprox(usePlace().place);
  const meta = [shop.mall_name, formatKm(shop.distance_km, approx) || shop.category_name]
    .filter(Boolean)
    .join(' · ');
  return (
    <Link className="shop-card" to={`/shop/${shop.shop_id}`} onClick={() => track('click', shop.shop_id)}>
      <Thumb imageKey={shop.logo_key} icon={shop.category_icon} />
      <div>
        <h4>{shop.name}</h4>
        <div className="meta">
          {meta}
          {showStatus && state && (
            <>
              {meta ? ' · ' : ''}
              <span style={{ color: state.open ? '#16a85a' : '#e53a42' }}>{state.label}</span>
            </>
          )}
        </div>
        {shop.top_offer ? (
          <span className="offer">
            {shop.top_offer}
            {shop.offer_count > 1 ? ` +${shop.offer_count - 1} more` : ''}
          </span>
        ) : (
          <span className="offer" style={{ background: '#eef2f7', color: 'var(--color-muted)' }}>
            No live offers right now
          </span>
        )}
      </div>
      <div className="chev">›</div>
    </Link>
  );
}

export function EmptyState({
  emoji,
  title,
  text,
  children,
}: {
  emoji: string;
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="saved-empty">
      <div className="emoji">{emoji}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}
