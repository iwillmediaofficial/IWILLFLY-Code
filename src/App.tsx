import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, ADMIN_ROLES } from './auth/AuthProvider';
import { RequireRole } from './auth/RequireRole';
import { ToastProvider } from './components/Toast';
import { LocationProvider } from './lib/location';
import Home from './customer/pages/Home';

// Each area is its own bundle, so customers never download vendor or admin code.
const Explore = lazy(() => import('./customer/pages/Explore'));
const Scratch = lazy(() => import('./customer/pages/Scratch'));
const Malls = lazy(() => import('./customer/pages/Malls'));
const Shop = lazy(() => import('./customer/pages/Shop'));
const Saved = lazy(() => import('./customer/pages/Saved'));
const Prizes = lazy(() => import('./customer/pages/Prizes'));
const Points = lazy(() => import('./customer/pages/Points'));
const Notifications = lazy(() => import('./customer/pages/Notifications'));
const Festival = lazy(() => import('./customer/pages/Festival'));
const History = lazy(() => import('./customer/pages/History'));
const Help = lazy(() => import('./customer/pages/Help'));
const Profile = lazy(() => import('./customer/pages/Profile'));
const Mall = lazy(() => import('./customer/pages/Mall'));
const Settings = lazy(() => import('./customer/pages/Settings'));
const Privacy = lazy(() => import('./customer/pages/Legal').then((m) => ({ default: m.Privacy })));
const Terms = lazy(() => import('./customer/pages/Legal').then((m) => ({ default: m.Terms })));
const Login = lazy(() => import('./auth/Login'));
const AdminLogin = lazy(() => import('./auth/AdminLogin'));
const VendorApply = lazy(() => import('./vendor/VendorApply'));
const VendorSignup = lazy(() => import('./vendor/VendorSignup'));
const VendorLogin = lazy(() => import('./vendor/VendorLogin'));
const VendorApp = lazy(() => import('./vendor/VendorApp'));
const AdminApp = lazy(() => import('./admin/AdminApp'));

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <LocationProvider>
          <ToastProvider>
            <Suspense fallback={<div className="app-shell" />}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/explore" element={<Explore />} />
                <Route path="/scratch" element={<Scratch />} />
                <Route path="/malls" element={<Malls />} />
                <Route path="/mall/:id" element={<Mall />} />
                <Route path="/shop/:id" element={<Shop />} />
                <Route path="/saved" element={<Saved />} />
                <Route path="/prizes" element={<Prizes />} />
                <Route path="/points/*" element={<Points />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/festival/:slug" element={<Festival />} />
                <Route path="/history" element={<History />} />
                <Route path="/help/*" element={<Help />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/login" element={<Login />} />
                <Route path="/admin/login" element={<AdminLogin />} />
                <Route path="/vendor/apply" element={<VendorApply />} />
                <Route path="/vendor/signup" element={<VendorSignup />} />
                <Route path="/vendor/login" element={<VendorLogin />} />
                <Route
                  path="/vendor/*"
                  element={
                    <RequireRole roles={['vendor']} loginPath="/vendor/login">
                      <VendorApp />
                    </RequireRole>
                  }
                />
                <Route
                  path="/admin/*"
                  element={
                    <RequireRole roles={ADMIN_ROLES} loginPath="/admin/login">
                      <AdminApp />
                    </RequireRole>
                  }
                />
                <Route path="*" element={<Home />} />
              </Routes>
            </Suspense>
          </ToastProvider>
        </LocationProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
