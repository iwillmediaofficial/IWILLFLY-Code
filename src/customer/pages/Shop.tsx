import { useParams } from 'react-router-dom';
import { AppShell, BackHeader } from '../../components/AppShell';
import { useToast } from '../../components/Toast';
import { shopIsOpen, shops } from '../../data/demo';
import { saveOffer } from '../saved';

export default function Shop() {
  const { id } = useParams();
  const toast = useToast();
  const s = shops.find((x) => x.id === id) ?? shops[0];
  const save = (key: string) => {
    saveOffer(key);
    toast('Offer saved');
  };

  return (
    <AppShell
      header={
        <BackHeader
          back="/explore"
          title="Shop details"
          subtitle="Live offers & timings"
          actions={
            <button className="icon-btn" onClick={() => save(`shop-${s.id}`)}>
              ♡
            </button>
          }
        />
      }
    >
      <section className="hero">
        <div style={{ fontSize: 52 }}>{s.icon}</div>
        <h1>{s.name}</h1>
        <p>
          {s.mall ? `${s.mall} · ` : ''}
          {s.distance} km ·{' '}
          {shopIsOpen(s) ? (
            <b style={{ color: '#16a85a' }}>Open now</b>
          ) : (
            <b style={{ color: '#e53a42' }}>Closed now</b>
          )}
        </p>
        <span className="hero-pill">{s.offer}</span>
      </section>
      <section className="section">
        <div className="info-grid">
          <div className="info-card">
            <span>Today’s hours</span>
            <strong style={{ fontSize: 16 }}>
              {s.open} – {s.close}
            </strong>
          </div>
          <div className="info-card">
            <span>Distance</span>
            <strong style={{ fontSize: 16 }}>Nearby</strong>
          </div>
        </div>
      </section>
      <section className="section">
        <div className="section-head">
          <h2>Live offers</h2>
        </div>
        <div className="offer-row">
          <article className="offer-card">
            <div className="offer-image pink">
              <span className="badge">50% OFF</span>
              <b>🔥</b>
            </div>
            <div className="offer-body">
              <h4>Festival Collection</h4>
              <div className="meta">Selected products only</div>
              <div className="offer-cta">
                <strong onClick={() => save('festival-offer')}>♡ Save</strong>
                <span>→</span>
              </div>
            </div>
          </article>
          <article className="offer-card">
            <div className="offer-image">
              <span className="badge">NEW</span>
              <b>🎁</b>
            </div>
            <div className="offer-body">
              <h4>Member Special</h4>
              <div className="meta">IWILLFLY exclusive</div>
              <div className="offer-cta">
                <strong onClick={() => save('member-offer')}>♡ Save</strong>
                <span>→</span>
              </div>
            </div>
          </article>
        </div>
      </section>
      <section className="section form-card">
        <h3 style={{ marginTop: 0 }}>Visit this shop</h3>
        <p className="meta" style={{ lineHeight: 1.6 }}>
          The final app can use live customer location to calculate accurate distance, directions, branch
          availability and nearby offers.
        </p>
        <button className="btn yellow" onClick={() => toast('Demo directions opened')}>
          📍 Get directions
        </button>
      </section>
    </AppShell>
  );
}
