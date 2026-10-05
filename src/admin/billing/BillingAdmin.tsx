import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { Active } from './Active';
import { Addons } from './Addons';
import { BillVendor, InvoiceDetail, Invoices } from './Invoices';
import { Plans } from './Plans';
import { Settings } from './Settings';

const SUB_TABS = [
  { to: '/admin/billing/invoices', label: 'Invoices' },
  { to: '/admin/billing/plans', label: 'Plans' },
  { to: '/admin/billing/addons', label: 'Add-ons' },
  { to: '/admin/billing/active', label: 'Active' },
  { to: '/admin/billing/settings', label: 'Settings' },
];

export default function BillingAdmin() {
  return (
    <>
      <nav className="tabs no-print" aria-label="Billing sections">
        {SUB_TABS.map((t) => (
          <NavLink key={t.to} to={t.to}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Navigate to="/admin/billing/invoices" replace />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="invoices/new" element={<BillVendor />} />
        <Route path="invoices/:id" element={<InvoiceDetail />} />
        <Route path="plans" element={<Plans />} />
        <Route path="addons" element={<Addons />} />
        <Route path="active" element={<Active />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/admin/billing/invoices" replace />} />
      </Routes>
    </>
  );
}
