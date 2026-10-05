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
import { ErrorNote, Loading } from './ui';

const tabs = [
  { to: '/vendor', label: 'Dashboard', end: true },
  { to: '/vendor/shops', label: 'Shops' },
  { to: '/vendor/offers', label: 'Offers' },
];

export default function VendorApp() {
  const { data: vendor, isPending, error } = useMyVendorRow();

  return (
    <div className="app-shell">
      <BackHeader
        back="/"
        title="Vendor dashboard"
        subtitle={vendor?.business_name ?? 'IWILLFLY for business'}
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
            <nav className="tabs" aria-label="Vendor sections">
              {tabs.map((t) => (
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
              <Route path="*" element={<Navigate to="/vendor" replace />} />
            </Routes>
          </VendorContext.Provider>
        )}
      </main>
    </div>
  );
}
