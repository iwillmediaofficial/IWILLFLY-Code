import { useQuery } from '@tanstack/react-query';
import { Link, matchPath, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
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
type CountKey = 'vendors' | 'offers' | 'points' | 'billing' | 'support';
type Tab = { to: string; label: string; icon: string; end?: boolean; roles: AppRole[]; count?: CountKey };

const tabs: Tab[] = [
  { to: '/admin', label: 'Dashboard', icon: '◧', end: true, roles: EVERYONE },
  { to: '/admin/vendors', label: 'Vendors', icon: '🏬', roles: ADMIN, count: 'vendors' },
  { to: '/admin/offers', label: 'Offers', icon: '🏷️', roles: ADMIN, count: 'offers' },
  { to: '/admin/scratch', label: 'Scratch & Win', icon: '🎟️', roles: CAMPAIGN },
  { to: '/admin/festivals', label: 'Festivals', icon: '🪔', roles: CAMPAIGN },
  { to: '/admin/ads', label: 'Home ads', icon: '🖼️', roles: CAMPAIGN },
  { to: '/admin/requests', label: 'Requests', icon: '📥', roles: CAMPAIGN },
  { to: '/admin/notify', label: 'Notify', icon: '🔔', roles: CAMPAIGN },
  { to: '/admin/analytics', label: 'Analytics', icon: '📈', roles: CAMPAIGN },
  { to: '/admin/reports', label: 'Reports', icon: '📄', roles: ADMIN },
  { to: '/admin/points', label: 'Points', icon: '⭐', roles: ADMIN, count: 'points' },
  { to: '/admin/billing', label: 'Billing', icon: '💳', roles: ADMIN, count: 'billing' },
  { to: '/admin/support', label: 'Support', icon: '💬', roles: SUPPORT, count: 'support' },
  { to: '/admin/team', label: 'Team', icon: '👥', roles: ADMIN },
  { to: '/admin/audit', label: 'Audit log', icon: '🧾', roles: ADMIN },
  { to: '/admin/categories', label: 'Categories', icon: '🗂️', roles: ADMIN },
  { to: '/admin/malls', label: 'Malls', icon: '🏢', roles: ADMIN },
  { to: '/admin/locations', label: 'Locations', icon: '📍', roles: ADMIN },
];

/** How the desktop sidebar groups the tabs above. */
const GROUPS: { label: string; items: string[] }[] = [
  { label: 'Overview', items: ['Dashboard', 'Analytics', 'Reports'] },
  { label: 'Marketplace', items: ['Vendors', 'Offers', 'Categories', 'Malls', 'Locations'] },
  { label: 'Engagement', items: ['Scratch & Win', 'Festivals', 'Home ads', 'Requests', 'Notify'] },
  { label: 'Money', items: ['Points', 'Billing'] },
  { label: 'Team', items: ['Support', 'Team', 'Audit log'] },
];

const ROLE_TITLE: [AppRole, string][] = [
  ['super_admin', 'Super admin'],
  ['admin', 'Admin'],
  ['campaign_manager', 'Campaign manager'],
  ['support', 'Support'],
];

export default function AdminApp() {
  const { session, roles, signOut } = useAuth();
  const { pathname } = useLocation();
  const visible = tabs.filter((t) => t.roles.some((r) => roles.includes(r)));
  const title = ROLE_TITLE.find(([r]) => roles.includes(r))?.[1] ?? 'Admin';
  const email = session?.user.email ?? '';
  const counts = useNavCounts();
  const current =
    visible.find((t) => t.end && matchPath({ path: t.to, end: true }, pathname)) ??
    visible.find((t) => !t.end && matchPath({ path: t.to, end: false }, pathname)) ??
    visible[0];
  const group = GROUPS.find((g) => current && g.items.includes(current.label))?.label;
  return (
    <div className="app-shell admin-shell">
      <aside className="admin-side">
        <Link to="/" className="admin-side-logo">
          <img src="/iwillfly-logo.webp" alt="IWILLFLY" width={132} height={44} />
        </Link>
        <nav className="admin-side-nav" aria-label="Admin sections">
          {GROUPS.map((g) => {
            const items = g.items
              .map((label) => visible.find((t) => t.label === label))
              .filter((t): t is Tab => t != null);
            if (items.length === 0) return null;
            return (
              <div key={g.label} className="admin-side-group">
                <div className="admin-side-label">{g.label}</div>
                {items.map((t) => {
                  const n = t.count ? counts[t.count] : 0;
                  return (
                    <NavLink key={t.label} to={t.to} end={t.end}>
                      <i aria-hidden="true">{t.icon}</i>
                      <span>{t.label}</span>
                      {n > 0 && <b className="admin-side-count">{n}</b>}
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="admin-side-user">
          <span className="admin-avatar" aria-hidden="true">
            {(email[0] ?? 'A').toUpperCase()}
          </span>
          <div style={{ minWidth: 0 }}>
            <b>{title}</b>
            <div className="admin-side-email">{email}</div>
          </div>
          <button className="icon-btn" aria-label="Sign out" title="Sign out" onClick={() => signOut()}>
            ⎋
          </button>
        </div>
      </aside>
      <div className="admin-main">
        <LogoHeader
          actions={
            <>
              <div style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.3 }}>
                <b style={{ fontSize: 13 }}>{title}</b>
                <div style={{ opacity: 0.8 }}>{email}</div>
              </div>
              <button className="icon-btn" aria-label="Sign out" title="Sign out" onClick={() => signOut()}>
                ⎋
              </button>
            </>
          }
        />
        <div className="admin-topbar">
          <div className="admin-crumb">
            {group && <span>{group}</span>}
            {group && <i aria-hidden="true">›</i>}
            <b>{current?.label}</b>
          </div>
          <div className="meta">
            {new Date().toLocaleDateString('en-IN', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </div>
        </div>
        <AdminPage visible={visible} />
      </div>
    </div>
  );
}

function AdminPage({ visible }: { visible: Tab[] }) {
  return (
    <main className="page">
      <nav className="tabs wrap admin-tabs" aria-label="Admin sections">
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

function useAccess() {
  const { roles } = useAuth();
  const isAdmin = roles.some((r) => ADMIN.includes(r));
  const isSupport = isAdmin || roles.includes('support');
  return { isAdmin, isSupport };
}

/** Marketplace totals. Shared (same query key) by the dashboard and the sidebar badges. */
function useStats() {
  const { isAdmin } = useAccess();
  return useQuery({
    queryKey: ['admin_stats'],
    queryFn: async () => must<Stats>(await db().rpc('admin_stats')),
    enabled: isAdmin,
  });
}

/** Counts of work waiting. Shared (same query key) by the dashboard and the sidebar badges. */
function useAttention() {
  const { isAdmin, isSupport } = useAccess();
  return useQuery({
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
}

/** Badge numbers for the desktop sidebar. */
function useNavCounts(): Record<CountKey, number> {
  const s = useStats().data;
  const a = useAttention().data;
  return {
    vendors: s?.vendors_pending ?? 0,
    offers: s?.offers_pending ?? 0,
    points: (a?.bills ?? 0) + (a?.payouts ?? 0),
    billing: a?.invoices ?? 0,
    support: a?.tickets ?? 0,
  };
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function Dashboard() {
  const { roles } = useAuth();
  const { isAdmin, isSupport } = useAccess();
  const stats = useStats();
  const attention = useAttention();
  const title = ROLE_TITLE.find(([r]) => roles.includes(r))?.[1] ?? 'Admin';
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
  const attentionTiles: { label: string; icon: string; value: number | null | undefined; to: string }[] = [
    ...(isAdmin
      ? [
          {
            label: 'Payments to check',
            icon: '💳',
            value: a?.invoices,
            to: '/admin/billing/invoices?status=submitted',
          },
          {
            label: 'Customer bills to check',
            icon: '🧾',
            value: a?.bills,
            to: '/admin/points/bills?status=pending',
          },
          {
            label: 'Cash-outs to pay',
            icon: '💸',
            value: a?.payouts,
            to: '/admin/points/payouts?status=requested',
          },
        ]
      : []),
    { label: 'Open help tickets', icon: '💬', value: a?.tickets, to: '/admin/support?status=open' },
  ];
  return (
    <>
      <section className="hero admin-hero">
        <div>
          <h1 className="mobile-only">IWILLFLY Admin</h1>
          <h1 className="desktop-only">
            {greeting()}, {title}
          </h1>
          <p>
            {isAdmin
              ? 'Review new vendors and offers, and manage categories, malls and locations.'
              : isSupport
                ? 'Answer help requests from customers and vendors in the Support tab.'
                : 'Run Scratch & Win, festivals, home ads and notifications from the tabs above.'}
          </p>
        </div>
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
          <div className="info-grid attention-grid">
            {attentionTiles.map((t) => (
              <Link key={t.label} className="info-card attention-card" to={t.to}>
                <i className="attention-icon desktop-only" aria-hidden="true">
                  {t.icon}
                </i>
                <em className="attention-open desktop-only">Open ›</em>
                <strong style={t.value ? { color: 'var(--color-orange)' } : undefined}>
                  {attention.isPending ? '…' : (t.value ?? 0)}
                </strong>
                <span>
                  {t.label}
                  <span className="mobile-only"> ›</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
      {isAdmin && (
        <section className="section">
          <div className="section-head desktop-only">
            <h2>Marketplace at a glance</h2>
          </div>
          {stats.isPending && <Loading />}
          {stats.error && <ErrorNotice error={stats.error} />}
          {s && (
            <div className="info-grid stats-grid">
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
