import { AppShell, BackHeader } from '../components/AppShell';
import { UploadTest } from '../components/UploadTest';
import { useAuth } from '../auth/AuthProvider';

export default function VendorHome() {
  const { session } = useAuth();
  return (
    <AppShell
      header={<BackHeader back="/profile" title="Vendor dashboard" subtitle={session?.user.email ?? ''} />}
    >
      <section className="hero">
        <h1>Your shops</h1>
        <p>Shop profile, branches, business hours and offers arrive in Phase 1.</p>
        <span className="hero-pill">Vendor area</span>
      </section>
      <section className="section">
        <div className="info-grid">
          <div className="info-card">
            <span>Live offers</span>
            <strong>0</strong>
          </div>
          <div className="info-card">
            <span>Pending approval</span>
            <strong>0</strong>
          </div>
        </div>
      </section>
      <UploadTest />
    </AppShell>
  );
}
