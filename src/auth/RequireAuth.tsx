import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { PageLoader } from '../components/PageLoader';
import { useAuth } from './AuthProvider';

/** Shows children only to signed-in users; guests go to /login and come back here afterwards. RLS still enforces this on the server. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const { pathname, search, hash } = useLocation();

  if (loading) return <PageLoader />;
  if (!session) return <Navigate to="/login" replace state={{ from: pathname + search + hash }} />;
  return <>{children}</>;
}
