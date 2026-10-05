import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, ADMIN_ROLES } from './auth/AuthProvider';
import { RequireRole } from './auth/RequireRole';
import { ToastProvider } from './components/Toast';
import Home from './customer/pages/Home';

// Each area is its own bundle, so customers never download vendor or admin code.
const Explore = lazy(() => import('./customer/pages/Explore'));
const Scratch = lazy(() => import('./customer/pages/Scratch'));
const Malls = lazy(() => import('./customer/pages/Malls'));
const Shop = lazy(() => import('./customer/pages/Shop'));
const Saved = lazy(() => import('./customer/pages/Saved'));
const Profile = lazy(() => import('./customer/pages/Profile'));
const Login = lazy(() => import('./auth/Login'));
const VendorHome = lazy(() => import('./vendor/VendorHome'));
const AdminHome = lazy(() => import('./admin/AdminHome'));

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Suspense fallback={<div className="app-shell" />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/explore" element={<Explore />} />
              <Route path="/scratch" element={<Scratch />} />
              <Route path="/malls" element={<Malls />} />
              <Route path="/shop/:id" element={<Shop />} />
              <Route path="/saved" element={<Saved />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/login" element={<Login />} />
              <Route
                path="/vendor/*"
                element={
                  <RequireRole roles={['vendor']}>
                    <VendorHome />
                  </RequireRole>
                }
              />
              <Route
                path="/admin/*"
                element={
                  <RequireRole roles={ADMIN_ROLES}>
                    <AdminHome />
                  </RequireRole>
                }
              />
              <Route path="*" element={<Home />} />
            </Routes>
          </Suspense>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
