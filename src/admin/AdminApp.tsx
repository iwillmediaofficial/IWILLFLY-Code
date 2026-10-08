import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { LogoHeader } from '../components/AppShell';
import { useAuth, type AppRole } from '../auth/AuthProvider';
import { db, must } from '../lib/queries';
import { Categories } from './Categories';
import { Locations } from './Locations';
import { MallEdit, Malls } from './Malls';
import { Offers } from './Offers';
import ScratchAdmin from './scratch/ScratchAdmin';
import PointsAdmin from './points/PointsAdmin';
import AdminAds from './engagement/Ads';
import AdminAnalytics from './engagement/Analytics';
import AdminFestivals from './engagement/Festivals';
import AdminNotify from './engagement/Notify';
import AdminRequests from './engagement/Requests';
import AuditLog from './audit/AuditLog';
import BillingAdmin from './billing/BillingAdmin';
import SupportAdmin from './support/Support';
import AdminReports from './reports/Reports';
import Team from './team/Team';
import { ErrorNotice, Loading } from './ui';
import { VendorCreate, VendorDetail } from './VendorDetail';
import { Vendors } from './Vendors';

const ADMIN: AppRole[] = ['admin', 'super_admin'];
const CAMPAIGN: AppRole[] = [...ADMIN, 'campaign_manager'];
const SUPPORT: AppRole[] = [...ADMIN, 'support'];
const EVERYONE: AppRole[] = [...ADMIN, 'support', 'campaign_manager'];

/** Tabs by role. Hiding a tab is only a convenience: RLS decides what each role can read and change. */
const tabs: { to: string; label: string; end?: boolean; roles: AppRole[] }[] = [
  { to: '/admin', label: 'Dashboard', end: true, roles: EVERYONE },
  { to: '/admin/vendors', label: 'Vendors', roles: ADMIN },
  { to: '/admin/offers', label: 'Offers', roles: ADMIN },
  { to: '/admin/scratch', label: 'Scratch & Win', roles: CAMPAIGN },
  { to: '/admin/festivals', label: 'Festivals', roles: CAMPAIGN },
  { to: '/admin/ads', label: 'Home ads', roles: CAMPAIGN },
  { to: '/admin/requests', label: 'Requests', roles: CAMPAIGN },
  { to: '/admin/notify', label: 'Notify', roles: CAMPAIGN },
  { to: '/admin/analytics', label: 'Analytics', roles: CAMPAIGN },
  { to: '/admin/reports', label: 'Reports', roles: ADMIN },
  { to: '/admin/points', label: 'Points', roles: ADMIN },
  { to: '/admin/billing', label: 'Billing', roles: ADMIN },
  { to: '/admin/support', label: 'Support', roles: SUPPORT },
  { to: '/admin/team', label: 'Team', roles: ADMIN },
  { to: '/admin/audit', label: 'Audit log', roles: ADMIN },
  { to: '/admin/categories', label: 'Categories', roles: ADMIN },
  { to: '/admin/malls', label: 'Malls', roles: ADMIN },
  { to: '/admin/locations', label: 'Locations', roles: ADMIN },
];

const ROLE_TITLE: [AppRole, string][] = [
  ['super_admin', 'Super admin'],
  ['admin', 'Admin'],
  ['campaign_manager', 'Campaign manager'],
  ['support', 'Support'],
];

export default function AdminApp() {
  const { session, roles, signOut } = useAuth();
  const visible = tabs.filter((t) => t.roles.some((r) => roles.includes(r)));
  const title = ROLE_TITLE.find(([r]) => roles.includes(r))?.[1] ?? 'Admin';
  return (
    <div className="app-shell" style={{ maxWidth: 760, paddingBottom: 40 }}>
      <LogoHeader
        actions={
          <>
            <div style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.3 }}>
              <b style={{ fontSize: 13 }}>{title}</b>
              <div style={{ opacity: 0.8 }}>{session?.user.email}</div>
            </div>
            <button className="icon-btn" aria-label="Sign out" title="Sign out" onClick={() => signOut()}>
              ⎋
            </button>
          </>
        }
      />
      <main className="page">
        <nav className="tabs wrap" aria-label="Admin sections">
          {visible.map((t) => (
            <NavLink key={t.label} to={t.to} end={t.end}>
              {t.label}
            </NavLink>
          ))}
        </nav>
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="vendors" element={<Vendors />} />
          <Route path="vendors/new" element={<VendorCreate />} />
          <Route path="vendors/:id" element={<VendorDetail />} />
          <Route path="offers" element={<Offers />} />
          <Route path="categories" element={<Categories />} />
          <Route path="malls" element={<Malls />} />
          <Route path="malls/new" element={<MallEdit />} />
          <Route path="malls/:id" element={<MallEdit />} />
          <Route path="locations" element={<Locations />} />
          <Route path="scratch/*" element={<ScratchAdmin />} />
          <Route path="festivals/*" element={<AdminFestivals />} />
          <Route path="ads/*" element={<AdminAds />} />
          <Route path="requests" element={<AdminRequests />} />
          <Route path="notify" element={<AdminNotify />} />
          <Route path="analytics" element={<AdminAnalytics />} />
          <Route path="reports" element={<AdminReports />} />
          <Route path="points/*" element={<PointsAdmin />} />
          <Route path="billing/*" element={<BillingAdmin />} />
          <Route path="support/*" element={<SupportAdmin />} />
          <Route path="team" element={<Team />} />
          <Route path="audit" element={<AuditLog />} />
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

async function countRows(q: PromiseLike<{ count: number | null; error: { message: string } | null }>) {
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

function Dashboard() {
  const { roles } = useAuth();
  const isAdmin = roles.some((r) => ADMIN.includes(r));
  const isSupport = isAdmin || roles.includes('support');
  const stats = useQuery({
    queryKey: ['admin_stats'],
    queryFn: async () => must<Stats>(await db().rpc('admin_stats')),
    enabled: isAdmin,
  });
  const attention = useQuery({
    queryKey: ['admin-attention', isAdmin],
    queryFn: async () => {
      const [invoices, bills, payouts, tickets] = await Promise.all([
        isAdmin
          ? countRows(
              db().from('invoices').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
            )
          : Promise.resolve(null),
        isAdmin
          ? countRows(
              db()
                .from('bill_submissions')
                .select('id', { count: 'exact', head: true })
                .eq('status', 'pending'),
            )
          : Promise.resolve(null),
        isAdmin
          ? countRows(
              db().from('redemptions').select('id', { count: 'exact', head: true }).eq('status', 'requested'),
            )
          : Promise.resolve(null),
        countRows(
          db().from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'open'),
        ),
      ]);
      return { invoices, bills, payouts, tickets };
    },
    enabled: isSupport,
  });
  const s = stats.data;
  const a = attention.data;
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
  const attentionTiles: { label: string; value: number | null | undefined; to: string }[] = [
    ...(isAdmin
      ? [
          { label: 'Payments to check', value: a?.invoices, to: '/admin/billing/invoices?status=submitted' },
          { label: 'Customer bills to check', value: a?.bills, to: '/admin/points/bills?status=pending' },
          { label: 'Cash-outs to pay', value: a?.payouts, to: '/admin/points/payouts?status=requested' },
        ]
      : []),
    { label: 'Open help tickets', value: a?.tickets, to: '/admin/support?status=open' },
  ];
  return (
    <>
      <section className="hero">
        <h1>IWILLFLY Admin</h1>
        <p>
          {isAdmin
            ? 'Review new vendors and offers, and manage categories, malls and locations.'
            : isSupport
              ? 'Answer help requests from customers and vendors in the Support tab.'
              : 'Run Scratch & Win, festivals, home ads and notifications from the tabs above.'}
        </p>
        {s && s.vendors_pending + s.offers_pending > 0 && (
          <span className="hero-pill">{s.vendors_pending + s.offers_pending} items need review</span>
        )}
      </section>
      {isSupport && (
        <section className="section">
          <div className="section-head">
            <h2>Needs attention</h2>
          </div>
          {attention.error && <ErrorNotice error={attention.error} />}
          <div className="info-grid">
            {attentionTiles.map((t) => (
              <Link key={t.label} className="info-card" to={t.to}>
                <strong style={t.value ? { color: 'var(--color-orange)' } : undefined}>
                  {attention.isPending ? '…' : (t.value ?? 0)}
                </strong>
                <span>{t.label} ›</span>
              </Link>
            ))}
          </div>
        </section>
      )}
      {isAdmin && (
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
      )}
    </>
  );
}
