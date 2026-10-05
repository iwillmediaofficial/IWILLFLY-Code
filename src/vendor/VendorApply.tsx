import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { AppShell, LogoHeader } from '../components/AppShell';
import { ApplyForm } from './ApplyForm';

const perks = [
  ['🏪', 'Your shops on the map', 'Branches, hours and directions for nearby customers'],
  ['🏷️', 'Post offers any time', 'Each offer goes live once our team has checked it'],
];

export default function VendorApply() {
  const { session, roles, loading } = useAuth();

  if (loading) return <div className="center-screen meta">Loading…</div>;
  if (roles.includes('vendor')) return <Navigate to="/vendor" replace />;

  return (
    <AppShell header={<LogoHeader />}>
      <section className="hero">
        <h1>Sell on IWILLFLY</h1>
        <p>
          List your shop and offers for shoppers nearby. Your shops go live after the IWILLFLY team approves
          your business.
        </p>
        <span className="hero-pill">For shop owners</span>
      </section>
      <section className="section list">
        {perks.map(([icon, title, meta]) => (
          <div key={title} className="shop-card" style={{ cursor: 'default' }}>
            <div className="shop-thumb">{icon}</div>
            <div>
              <h4>{title}</h4>
              <div className="meta">{meta}</div>
            </div>
            <span />
          </div>
        ))}
      </section>
      <section className="section">
        {session ? (
          <ApplyForm />
        ) : (
          <div className="form-card">
            <h3 style={{ marginTop: 0 }}>Get started</h3>
            <p className="meta">Create a vendor account with your business details in one step.</p>
            <Link
              className="btn block"
              to="/vendor/signup"
              style={{ display: 'block', textAlign: 'center', marginTop: 12 }}
            >
              Register your business
            </Link>
            <Link
              className="btn secondary block"
              to="/vendor/login"
              style={{ display: 'block', textAlign: 'center', marginTop: 8 }}
            >
              Already a vendor? Sign in
            </Link>
            <p className="meta" style={{ marginBottom: 0 }}>
              Already shop with us?{' '}
              <Link to="/login" state={{ from: '/vendor/apply' }}>
                Sign in with your customer account
              </Link>{' '}
              and add your business to it.
            </p>
          </div>
        )}
      </section>
    </AppShell>
  );
}
