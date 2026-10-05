import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth, type AppRole } from './AuthProvider';

/** Shows children only to signed-in users holding one of the roles. RLS still enforces this on the server. */
export function RequireRole({ roles, children }: { roles: AppRole[]; children: ReactNode }) {
  const { session, roles: mine, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="center-screen meta">Loading…</div>;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!mine.some((r) => roles.includes(r))) {
    return (
      <div className="center-screen">
        <div>
          <div style={{ fontSize: 48 }}>🔒</div>
          <h3 style={{ margin: '10px 0 5px' }}>No access</h3>
          <p className="meta">Your account does not have access to this area.</p>
          <Link className="btn" to="/" style={{ display: 'inline-block', marginTop: 12 }}>
            Go home
          </Link>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
