import { Link } from 'react-router-dom';
import { AppShell, LogoHeader } from '../../components/AppShell';
import { ADMIN_ROLES, useAuth } from '../../auth/AuthProvider';
import { usePlace } from '../../lib/location';
import { useSavedIds } from '../../lib/queries';
import { useMyPrizes } from '../../lib/scratch';

const pad = (n: number | undefined) => (n == null ? '–' : String(n).padStart(2, '0'));

export default function Profile() {
  const { session, roles, signOut } = useAuth();
  const { place } = usePlace();
  const savedOffers = useSavedIds('offer');
  const savedShops = useSavedIds('shop');
  const myPrizes = useMyPrizes();
  const email = session?.user.email ?? '';
  const name =
    (session?.user.user_metadata?.full_name as string | undefined) ?? (email ? email.split('@')[0] : 'Guest');

  return (
    <AppShell
      header={
        <LogoHeader
          actions={
            <Link className="icon-btn" to="/settings" aria-label="Settings">
              ⚙
            </Link>
          }
        />
      }
    >
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
            <strong>{session ? pad(savedOffers.data?.size) : '00'}</strong>
          </div>
          <div className="info-card">
            <span>Shops saved</span>
            <strong>{session ? pad(savedShops.data?.size) : '00'}</strong>
          </div>
          <div className="info-card">
            <span>Wins</span>
            <strong>{session ? pad(myPrizes.data?.length) : '00'}</strong>
          </div>
          <div className="info-card">
            <span>Your area</span>
            <strong style={{ fontSize: 16 }}>{place?.label ?? 'Not set'}</strong>
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
          {session && !roles.includes('vendor') && (
            <ProfileRow
              to="/vendor/apply"
              icon="🏪"
              title="Become a vendor"
              meta="List your shop and post offers for free"
            />
          )}
          <ProfileRow
            to="/settings"
            icon="📍"
            title="Location & nearby offers"
            meta={place ? `Showing offers near ${place.label}` : 'Set your area for nearby offers'}
          />
          <ProfileRow to="/prizes" icon="🏆" title="My Prizes" meta="Your wins and claim codes" />
          <ProfileRow to="/scratch" icon="🎁" title="My Scratch & Win history" meta="Daily prize activity" />
          <ProfileRow to="/history" icon="🕘" title="Recently viewed" meta="Offers you looked at" />
          <ProfileRow
            to="/notifications"
            icon="🔔"
            title="Notifications"
            meta="Festival, nearby and saved offers"
          />
          <ProfileRow to="/help" icon="💬" title="Help & support" meta="Ask the IWILLFLY team a question" />
          <ProfileRow to="/settings" icon="🔒" title="Privacy & account" meta="Your data and sign out" />
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
