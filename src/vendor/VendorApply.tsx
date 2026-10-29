import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { AppShell, LogoHeader } from '../components/AppShell';
import { VendorOnboarding } from './onboarding/VendorOnboarding';
import { Store, Tag } from 'lucide-react';
import { Icon, type LucideIcon } from '../components/Icon';

const perks: [LucideIcon, string, string][] = [
  [Store, 'Your shops on the map', 'Branches, hours and directions for nearby customers'],
  [Tag, 'Post offers any time', 'Each offer goes live once our team has checked it'],
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
          Choose a plan, add your shop with its location and hours, and send it to us. Your shop goes live
          after the IWILLFLY team approves it.
        </p>
        <span className="hero-pill">For shop owners</span>
      </section>
      <section className="section list">
        {perks.map(([icon, title, meta]) => (
          <div key={title} className="shop-card" style={{ cursor: 'default' }}>
            <div className="shop-thumb">
              <Icon icon={icon} />
            </div>
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
          <VendorOnboarding />
        ) : (
          <div className="form-card">
            <h3 style={{ marginTop: 0 }}>Get started</h3>
            <p className="meta">Create a vendor account, then add your shop step by step.</p>
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
