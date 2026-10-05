import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { LogoHeader } from '../components/AppShell';
import { useAuth } from '../auth/AuthProvider';
import { db, must } from '../lib/queries';
import { Categories } from './Categories';
import { Locations } from './Locations';
import { MallEdit, Malls } from './Malls';
import { Offers } from './Offers';
import { ErrorNotice, Loading } from './ui';
import { Vendors } from './Vendors';

const tabs = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/vendors', label: 'Vendors' },
  { to: '/admin/offers', label: 'Offers' },
  { to: '/admin/categories', label: 'Categories' },
  { to: '/admin/malls', label: 'Malls' },
  { to: '/admin/locations', label: 'Locations' },
];

export default function AdminApp() {
  const { session, signOut } = useAuth();
  return (
    <div className="app-shell" style={{ maxWidth: 760, paddingBottom: 40 }}>
      <LogoHeader
        actions={
          <>
            <div style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.3 }}>
              <b style={{ fontSize: 13 }}>Admin</b>
              <div style={{ opacity: 0.8 }}>{session?.user.email}</div>
            </div>
            <button className="icon-btn" aria-label="Sign out" title="Sign out" onClick={() => signOut()}>
              ⎋
            </button>
          </>
        }
      />
      <main className="page">
        <nav className="tabs" aria-label="Admin sections">
          {tabs.map((t) => (
            <NavLink key={t.label} to={t.to} end={t.end}>
              {t.label}
            </NavLink>
          ))}
        </nav>
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="vendors" element={<Vendors />} />
          <Route path="offers" element={<Offers />} />
          <Route path="categories" element={<Categories />} />
          <Route path="malls" element={<Malls />} />
          <Route path="malls/new" element={<MallEdit />} />
          <Route path="malls/:id" element={<MallEdit />} />
          <Route path="locations" element={<Locations />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>
    </div>
  );
}

interface Stats {
  vendors: number;
  vendors_pending: number;
  customers: number;
  shops: number;
  malls: number;
  offers_live: number;
  offers_pending: number;
}

function Dashboard() {
  const stats = useQuery({
    queryKey: ['admin_stats'],
    queryFn: async () => must<Stats>(await db().rpc('admin_stats')),
  });
  const s = stats.data;
  const tiles: { label: string; value: number | undefined; to?: string; alert?: boolean }[] = [
    {
      label: 'Vendors waiting for review',
      value: s?.vendors_pending,
      to: '/admin/vendors?status=pending',
      alert: true,
    },
    {
      label: 'Offers waiting for review',
      value: s?.offers_pending,
      to: '/admin/offers?tab=pending',
      alert: true,
    },
    { label: 'Live offers', value: s?.offers_live, to: '/admin/offers?tab=approved' },
    { label: 'Vendors', value: s?.vendors, to: '/admin/vendors?status=all' },
    { label: 'Shops', value: s?.shops },
    { label: 'Malls', value: s?.malls, to: '/admin/malls' },
    { label: 'Customers', value: s?.customers },
  ];
  return (
    <>
      <section className="hero">
        <h1>IWILLFLY Admin</h1>
        <p>Review new vendors and offers, and manage categories, malls and locations.</p>
        {s && s.vendors_pending + s.offers_pending > 0 && (
          <span className="hero-pill">{s.vendors_pending + s.offers_pending} items need review</span>
        )}
      </section>
      <section className="section">
        {stats.isPending && <Loading />}
        {stats.error && <ErrorNotice error={stats.error} />}
        {s && (
          <div className="info-grid">
            {tiles.map((t) => {
              const body = (
                <>
                  <strong style={t.alert && t.value ? { color: 'var(--color-orange)' } : undefined}>
                    {t.value ?? 0}
                  </strong>
                  <span>
                    {t.label}
                    {t.to ? ' ›' : ''}
                  </span>
                </>
              );
              return t.to ? (
                <Link key={t.label} className="info-card" to={t.to}>
                  {body}
                </Link>
              ) : (
                <div key={t.label} className="info-card">
                  {body}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
