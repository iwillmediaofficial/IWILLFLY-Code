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
const Profile = lazy(() => import('./customer/pages/Profile'));
const Mall = lazy(() => import('./customer/pages/Mall'));
const Settings = lazy(() => import('./customer/pages/Settings'));
const Login = lazy(() => import('./auth/Login'));
const AdminLogin = lazy(() => import('./auth/AdminLogin'));
const VendorApply = lazy(() => import('./vendor/VendorApply'));
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
                <Route path="/profile" element={<Profile />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/login" element={<Login />} />
                <Route path="/admin/login" element={<AdminLogin />} />
                <Route path="/vendor/apply" element={<VendorApply />} />
                <Route
                  path="/vendor/*"
                  element={
                    <RequireRole roles={['vendor']}>
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
