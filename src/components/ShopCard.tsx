import { Link } from 'react-router-dom';
import { shopIsOpen, type DemoShop } from '../data/demo';

export function ShopCard({ shop, showStatus = true }: { shop: DemoShop; showStatus?: boolean }) {
  const open = shopIsOpen(shop);
  return (
    <Link className="shop-card" to={`/shop/${shop.id}`}>
      <div className="shop-thumb">{shop.icon}</div>
      <div>
        <h4>{shop.name}</h4>
        <div className="meta">
          {shop.mall ? `${shop.mall} · ` : ''}
          {shop.distance} km
          {showStatus && (
            <>
              {' · '}
              {open ? (
                <span style={{ color: '#16a85a' }}>Open now</span>
              ) : (
                <span style={{ color: '#e53a42' }}>Closed</span>
              )}
            </>
          )}
        </div>
        <span className="offer">{shop.offer}</span>
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
  children?: React.ReactNode;
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
