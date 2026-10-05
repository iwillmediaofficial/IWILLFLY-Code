import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { BackHeader } from '../components/AppShell';
import { useMyVendorRow } from './api';
import { ApplyForm } from './ApplyForm';
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
import type { VendorRole } from '../lib/types';
import { ErrorNote, Loading } from './ui';

// staffToo: shown to Staff, who only check prize codes and see insights.
const tabs = [
  { to: '/vendor', label: 'Dashboard', end: true, staffToo: true },
  { to: '/vendor/shops', label: 'Shops' },
  { to: '/vendor/offers', label: 'Offers' },
  { to: '/vendor/scratch', label: 'Scratch & Win', staffToo: true },
  { to: '/vendor/insights', label: 'Insights', staffToo: true },
  { to: '/vendor/festivals', label: 'Festivals' },
  { to: '/vendor/promote', label: 'Promote' },
  { to: '/vendor/billing', label: 'Plan & billing', staffToo: true },
  { to: '/vendor/team', label: 'Team', staffToo: true },
  { to: '/vendor/help', label: 'Help', staffToo: true },
];

const roleName: Record<VendorRole, string> = { owner: 'Owner', manager: 'Manager', staff: 'Staff' };

export default function VendorApp() {
  const { data: vendor, isPending, error } = useMyVendorRow();

  return (
    <div className="app-shell">
      <BackHeader
        back="/"
        title="Vendor dashboard"
        subtitle={
          vendor
            ? vendor.my_role === 'owner'
              ? vendor.business_name
              : `${vendor.business_name} · ${roleName[vendor.my_role]}`
            : 'IWILLFLY for business'
        }
      />
      <main className="page">
        {isPending ? (
          <Loading />
        ) : error ? (
          <ErrorNote error={error} />
        ) : !vendor ? (
          // Has the vendor role but no business yet (e.g. role granted by hand): register here.
          <>
            <div className="notice">Tell us about your business to start adding shops.</div>
            <ApplyForm />
          </>
        ) : (
          <VendorContext.Provider value={vendor}>
            <nav className="tabs wrap" aria-label="Vendor sections">
              {tabs
                .filter((t) => t.staffToo || vendor.my_role !== 'staff')
                .map((t) => (
                  <NavLink key={t.to} to={t.to} end={t.end}>
                    {t.label}
                  </NavLink>
                ))}
            </nav>
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
          </VendorContext.Provider>
        )}
      </main>
    </div>
  );
}
