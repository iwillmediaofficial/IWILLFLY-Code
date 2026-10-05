import { AppShell, BackHeader } from '../components/AppShell';
import { UploadTest } from '../components/UploadTest';
import { useAuth } from '../auth/AuthProvider';

export default function AdminHome() {
  const { session, roles } = useAuth();
  return (
    <AppShell
      header={<BackHeader back="/profile" title="Admin dashboard" subtitle={session?.user.email ?? ''} />}
    >
      <section className="hero">
        <h1>IWILLFLY Admin</h1>
        <p>Vendor approval, categories, malls and offer moderation arrive in Phase 1.</p>
        <span className="hero-pill">Roles: {roles.join(', ')}</span>
      </section>
      <section className="section">
        <div className="info-grid">
          <div className="info-card">
            <span>Vendors</span>
            <strong>0</strong>
          </div>
          <div className="info-card">
            <span>Offers to review</span>
            <strong>0</strong>
          </div>
        </div>
      </section>
      <UploadTest />
    </AppShell>
  );
}
