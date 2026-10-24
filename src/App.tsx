import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, ADMIN_ROLES } from './auth/AuthProvider';
import { ProfileGate } from './auth/ProfileGate';
import { RequireAuth } from './auth/RequireAuth';
import { RequireRole } from './auth/RequireRole';
import { AccountPlaceSync } from './components/LocationButton';
import { PageLoader } from './components/PageLoader';
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
const PointsTermsPage = lazy(() =>
  import('./customer/pages/Points').then((m) => ({ default: m.PointsTermsPage })),
);
const Login = lazy(() => import('./auth/Login'));
const CompleteProfile = lazy(() => import('./auth/CompleteProfile'));
const AdminLogin = lazy(() => import('./auth/AdminLogin'));
const VendorApply = lazy(() => import('./vendor/VendorApply'));
const VendorSignup = lazy(() => import('./vendor/VendorSignup'));
const VendorLogin = lazy(() => import('./vendor/VendorLogin'));
const VendorApp = lazy(() => import('./vendor/VendorApp'));
const AdminApp = lazy(() => import('./admin/AdminApp'));

/** The customer app is for signed-in users only; guests are sent to /login. */
const signedIn = (page: ReactNode) => <RequireAuth>{page}</RequireAuth>;

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <LocationProvider>
          <ToastProvider>
            <ProfileGate />
            <AccountPlaceSync />
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={signedIn(<Home />)} />
                <Route path="/explore" element={signedIn(<Explore />)} />
                <Route path="/scratch" element={signedIn(<Scratch />)} />
                <Route path="/malls" element={signedIn(<Malls />)} />
                <Route path="/mall/:id" element={signedIn(<Mall />)} />
                <Route path="/shop/:id" element={signedIn(<Shop />)} />
                <Route path="/saved" element={signedIn(<Saved />)} />
                <Route path="/prizes" element={signedIn(<Prizes />)} />
                {/* Open to guests, so the rules can be read before signing up. */}
                <Route path="/points/terms" element={<PointsTermsPage />} />
                <Route path="/points/*" element={signedIn(<Points />)} />
                <Route path="/notifications" element={signedIn(<Notifications />)} />
                <Route path="/festival/:slug" element={signedIn(<Festival />)} />
                <Route path="/history" element={signedIn(<History />)} />
                <Route path="/help/*" element={signedIn(<Help />)} />
                <Route path="/profile" element={signedIn(<Profile />)} />
                <Route path="/settings" element={signedIn(<Settings />)} />
                {/* Open to guests. */}
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/login" element={<Login />} />
                <Route path="/welcome" element={<CompleteProfile />} />
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
                <Route path="*" element={signedIn(<Home />)} />
              </Routes>
            </Suspense>
          </ToastProvider>
        </LocationProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
