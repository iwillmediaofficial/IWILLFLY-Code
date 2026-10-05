import { Link } from 'react-router-dom';
import { AppShell, LogoHeader } from '../../components/AppShell';
import { ADMIN_ROLES, useAuth } from '../../auth/AuthProvider';

const rows = [
  ['📍', 'Location & nearby offers', 'Allow while using app'],
  ['🎁', 'My Scratch & Win history', 'Daily prize activity'],
  ['🔔', 'Notifications', 'Festival, nearby and saved offers'],
  ['❓', 'Help & support', 'FAQs and customer assistance'],
];

export default function Profile() {
  const { session, roles, signOut } = useAuth();
  const email = session?.user.email ?? '';
  const name =
    (session?.user.user_metadata?.full_name as string | undefined) ?? (email ? email.split('@')[0] : 'Guest');

  return (
    <AppShell header={<LogoHeader actions={<button className="icon-btn">⚙</button>} />}>
      <section className="hero">
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: '#fff',
            color: '#1460d6',
            display: 'grid',
            placeItems: 'center',
            fontSize: 28,
            fontWeight: 900,
            marginBottom: 12,
          }}
        >
          {name.charAt(0).toUpperCase()}
        </div>
        <h1>{name}</h1>
        <p>{session ? email : 'Sign in to save offers and play Scratch & Win'}</p>
        {session ? (
          <span className="hero-pill">IWILLFLY Member</span>
        ) : (
          <Link className="hero-pill" to="/login">
            Sign in
          </Link>
        )}
      </section>
      <section className="section">
        <div className="info-grid">
          <div className="info-card">
            <span>Offers saved</span>
            <strong>08</strong>
          </div>
          <div className="info-card">
            <span>Wins</span>
            <strong>03</strong>
          </div>
          <div className="info-card">
            <span>Shops visited</span>
            <strong>17</strong>
          </div>
          <div className="info-card">
            <span>Vouchers used</span>
            <strong>05</strong>
          </div>
        </div>
      </section>
      <section className="section">
        <div className="list">
          {roles.includes('vendor') && (
            <ProfileRow to="/vendor" icon="🏪" title="Vendor dashboard" meta="Manage your shops and offers" />
          )}
          {roles.some((r) => ADMIN_ROLES.includes(r)) && (
            <ProfileRow to="/admin" icon="🛡️" title="Admin dashboard" meta="Vendors, offers and campaigns" />
          )}
          {rows.map(([icon, title, meta]) => (
            <div key={title} className="shop-card">
              <div className="shop-thumb">{icon}</div>
              <div>
                <h4>{title}</h4>
                <div className="meta">{meta}</div>
              </div>
              <div className="chev">›</div>
            </div>
          ))}
          {session && (
            <button className="btn secondary" onClick={signOut}>
              Sign out
            </button>
          )}
        </div>
      </section>
    </AppShell>
  );
}

function ProfileRow({ to, icon, title, meta }: { to: string; icon: string; title: string; meta: string }) {
  return (
    <Link className="shop-card" to={to}>
      <div className="shop-thumb">{icon}</div>
      <div>
        <h4>{title}</h4>
        <div className="meta">{meta}</div>
      </div>
      <div className="chev">›</div>
    </Link>
  );
}
