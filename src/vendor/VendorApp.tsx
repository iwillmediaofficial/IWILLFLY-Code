import { useEffect, useState } from 'react';
import { Link, matchPath, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { BackHeader, NotificationBell } from '../components/AppShell';
import { useMyOffers, useMyVendorRow } from './api';
import { VendorOnboarding } from './onboarding/VendorOnboarding';
import { VendorContext } from './context';
import Dashboard from './Dashboard';
import ShopsList from './ShopsList';
import ShopEditor from './ShopEditor';
import BranchEditor from './BranchEditor';
import OffersList from './OffersList';
import OfferEditor from './OfferEditor';
import VendorScratch from './scratch/VendorScratch';
import VendorFestivals from './engagement/Festivals';
import VendorInsights from './engagement/Insights';
import VendorPromote from './engagement/Promote';
import VendorBilling from './billing/Billing';
import VendorTeam from './team/Team';
import VendorHelp from './support/VendorHelp';
import type { MyVendor, VendorRole } from '../lib/types';
import { ErrorNote, Loading } from './ui';
import { offerPhase } from './format';

// staffToo: shown to Staff, who only check prize codes and see insights.
// branch: shown to branch managers ('manager') or to all branch members ('all'); others are brand-level.
type Tab = {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
  staffToo?: boolean;
  branch?: 'manager' | 'all';
  branchOnly?: boolean;
};

const tabs: Tab[] = [
  { to: '/vendor', label: 'Dashboard', icon: '🏠', end: true, staffToo: true, branch: 'all' },
  { to: '/vendor/branches/mine', label: 'My branch', icon: '📍', branch: 'all', branchOnly: true },
  { to: '/vendor/shops', label: 'My shop', icon: '🏬' },
  { to: '/vendor/offers', label: 'Offers', icon: '🏷️', branch: 'manager' },
  { to: '/vendor/scratch', label: 'Scratch & Win', icon: '🎟️', staffToo: true, branch: 'all' },
  { to: '/vendor/insights', label: 'Insights', icon: '📈', staffToo: true },
  { to: '/vendor/festivals', label: 'Festivals', icon: '🪔' },
  { to: '/vendor/promote', label: 'Promote', icon: '📣' },
  { to: '/vendor/billing', label: 'Plan & billing', icon: '💳', staffToo: true },
  { to: '/vendor/team', label: 'Team', icon: '👥', staffToo: true, branch: 'all' },
  { to: '/vendor/help', label: 'Help', icon: '💬', staffToo: true, branch: 'all' },
];

/** The menu for this member: branch members get their branch's pages only. */
function tabsFor(v: MyVendor): Tab[] {
  if (v.my_branch_id != null) {
    const manager = v.my_role === 'manager';
    return tabs
      .filter((t) => t.branch === 'all' || (t.branch === 'manager' && manager))
      .map((t) => (t.branchOnly ? { ...t, to: `/vendor/branches/${v.my_branch_id}` } : t));
  }
  const canEdit = v.my_role !== 'staff';
  return tabs.filter((t) => !t.branchOnly && (t.staffToo || canEdit));
}

/** How the side menu groups the tabs above. */
const GROUPS: { label: string; items: string[] }[] = [
  { label: 'My shop', items: ['Dashboard', 'My branch', 'My shop', 'Offers'] },
  { label: 'Grow sales', items: ['Scratch & Win', 'Insights', 'Festivals', 'Promote'] },
  { label: 'Account', items: ['Plan & billing', 'Team', 'Help'] },
];

/** An application from the earlier three-field form: pending, owned by this user, with no plan picked. */
const needsOnboarding = (v: MyVendor) => v.status === 'pending' && v.my_role === 'owner' && v.plan_id == null;

const roleName: Record<VendorRole, string> = { owner: 'Owner', manager: 'Manager', staff: 'Staff' };
const roleLabel = (v: MyVendor) =>
  v.my_branch_id != null
    ? `Branch ${v.my_role === 'manager' ? 'manager' : 'staff'} · ${v.my_branch_name ?? ''}`
    : roleName[v.my_role];

const statusName = { approved: 'Approved', blocked: 'Blocked', pending: 'Under review' } as const;

export default function VendorApp() {
  const { data: vendor, isPending, error } = useMyVendorRow();

  if (vendor && !needsOnboarding(vendor)) {
    return (
      <VendorContext.Provider value={vendor}>
        <VendorLayout vendor={vendor} />
      </VendorContext.Provider>
    );
  }

  return (
    <div className="app-shell">
      <BackHeader back="/" title="Vendor dashboard" subtitle="IWILLFLY for business" />
      <main className="page">
        {isPending ? (
          <Loading />
        ) : error ? (
          <ErrorNote error={error} />
        ) : (
          // No business yet (e.g. role granted by hand), or an earlier short application: finish it here.
          <>
            <div className="notice">Choose a plan and tell us about your shop to send your application.</div>
            <VendorOnboarding />
          </>
        )}
      </main>
    </div>
  );
}

/** Side menu (always open on desktop, slides in from ☰ on phones), header and the vendor pages. */
function VendorLayout({ vendor }: { vendor: MyVendor }) {
  const { pathname } = useLocation();
  // The page the menu was opened on: moving to another page closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const menuOpen = openOn === pathname;
  const setMenuOpen = (open: boolean) => setOpenOn(open ? pathname : null);
  const canEdit = vendor.my_role !== 'staff';
  const visible = tabsFor(vendor);
  const current =
    visible.find((t) => t.end && matchPath({ path: t.to, end: true }, pathname)) ??
    visible.find((t) => !t.end && matchPath({ path: t.to, end: false }, pathname)) ??
    visible[0];
  const group = GROUPS.find((g) => g.items.includes(current.label))?.label;

  // While the menu is open on a phone: Escape closes it and the page behind does not scroll.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenOn(null);
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [menuOpen]);

  return (
    <div className={`app-shell vendor-shell${menuOpen ? ' menu-open' : ''}`}>
      <div className="vendor-backdrop" aria-hidden="true" onClick={() => setMenuOpen(false)} />
      <aside className="vendor-side" id="vendor-menu" aria-label="Vendor menu">
        <div className="vendor-side-top">
          <Link to="/" className="vendor-side-logo">
            <img src="/iwillfly-logo.webp" alt="IWILLFLY" width={132} height={44} />
          </Link>
          <button
            className="icon-btn vendor-side-close"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          >
            ✕
          </button>
        </div>
        <div className="vendor-side-shop">
          <span className="vendor-avatar" aria-hidden="true">
            {vendor.business_name.trim()[0]?.toUpperCase() ?? 'V'}
          </span>
          <div style={{ minWidth: 0 }}>
            <b>{vendor.business_name}</b>
            <div>
              {roleLabel(vendor)} · <span className="vendor-status">{statusName[vendor.status]}</span>
            </div>
          </div>
        </div>
        <SideNav visible={visible} showCounts={canEdit} />
        <Link to="/" className="vendor-side-back">
          ‹ Back to IWILLFLY
        </Link>
      </aside>
      <div className="vendor-main">
        <header className="topbar vendor-topbar-mobile">
          <div className="top-row">
            <button
              className="icon-btn"
              aria-label="Open menu"
              aria-expanded={menuOpen}
              aria-controls="vendor-menu"
              onClick={() => setMenuOpen(true)}
            >
              <span className="burger" aria-hidden="true" />
            </button>
            <span className="vendor-avatar light" aria-hidden="true">
              {vendor.business_name.trim()[0]?.toUpperCase() ?? 'V'}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <b className="vendor-top-name">{vendor.business_name}</b>
              <div style={{ fontSize: 12, opacity: 0.85 }}>{current.label}</div>
            </div>
            <NotificationBell />
          </div>
        </header>
        <div className="vendor-topbar">
          <div className="admin-crumb">
            {group && <span>{group}</span>}
            {group && <i aria-hidden="true">›</i>}
            <b>{current.label}</b>
          </div>
          <div className="vendor-topbar-actions">
            <NotificationBell />
            {canEdit && vendor.status === 'approved' && (
              <Link className="btn" to="/vendor/offers/new">
                ＋ New offer
              </Link>
            )}
          </div>
        </div>
        <main className="page">
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="shops" element={<ShopsList />} />
            <Route path="shops/new" element={<ShopEditor />} />
            <Route path="shops/:id" element={<ShopEditor />} />
            <Route path="branches/new" element={<BranchEditor />} />
            <Route path="branches/:id" element={<BranchEditor />} />
            <Route path="offers" element={<OffersList />} />
            <Route path="offers/new" element={<OfferEditor />} />
            <Route path="offers/:id" element={<OfferEditor />} />
            <Route path="scratch/*" element={<VendorScratch />} />
            <Route path="insights" element={<VendorInsights />} />
            <Route path="festivals" element={<VendorFestivals />} />
            <Route path="promote" element={<VendorPromote />} />
            <Route path="billing/*" element={<VendorBilling />} />
            <Route path="team" element={<VendorTeam />} />
            <Route path="help/*" element={<VendorHelp />} />
            <Route path="*" element={<Navigate to="/vendor" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function SideNav({ visible, showCounts }: { visible: Tab[]; showCounts: boolean }) {
  return (
    <nav className="vendor-side-nav" aria-label="Vendor sections">
      {GROUPS.map((g) => {
        const items = g.items
          .map((label) => visible.find((t) => t.label === label))
          .filter((t): t is Tab => t != null);
        if (items.length === 0) return null;
        return (
          <div key={g.label} className="vendor-side-group">
            <div className="vendor-side-label">{g.label}</div>
            {items.map((t) => (
              <NavLink key={t.label} to={t.to} end={t.end}>
                <i aria-hidden="true">{t.icon}</i>
                <span>{t.label}</span>
                {showCounts && t.label === 'Offers' && <OffersInReview />}
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );
}

/** Yellow badge with the number of offers waiting for the IWILLFLY team (same query as the dashboard). */
function OffersInReview() {
  const { offers } = useMyOffers();
  const n = (offers ?? []).filter((o) => offerPhase(o) === 'pending').length;
  return n > 0 ? (
    <b className="vendor-side-count" title={`${n} in review`}>
      {n}
    </b>
  ) : null;
}
