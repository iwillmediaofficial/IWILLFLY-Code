import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell, LogoHeader } from '../../components/AppShell';
import { EmptyState } from '../../components/ShopCard';
import { getSaved, removeSaved } from '../saved';

export default function Saved() {
  const [ids, setIds] = useState(getSaved);
  return (
    <AppShell header={<LogoHeader actions={<button className="icon-btn">♡</button>} />}>
      <div className="section-head">
        <h2>Saved offers</h2>
        <button>Latest first</button>
      </div>
      <div className="list">
        {ids.length ? (
          ids.map((id, i) => (
            <div key={id} className="shop-card">
              <div className="shop-thumb">🎁</div>
              <div>
                <h4>Saved Offer {i + 1}</h4>
                <div className="meta">Valid this week · Nearby shop</div>
                <span className="offer">Special price</span>
              </div>
              <button
                className="close"
                aria-label="Remove"
                onClick={() => {
                  removeSaved(id);
                  setIds(getSaved());
                }}
              >
                ×
              </button>
            </div>
          ))
        ) : (
          <EmptyState
            emoji="♡"
            title="No saved offers yet"
            text="Tap the save button on an offer or shop to keep it here."
          >
            <Link className="btn" to="/explore" style={{ display: 'inline-block', marginTop: 12 }}>
              Explore offers
            </Link>
          </EmptyState>
        )}
      </div>
    </AppShell>
  );
}
