import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { AppShell, BackHeader } from '../../components/AppShell';
import { Inbox } from '../../components/Inbox';
import { EmptyState } from '../../components/ShopCard';
import { supabase } from '../../lib/supabase';
import { PushCard } from '../PushCard';
import { Loading, NoBackend } from '../ui';

export default function Notifications() {
  const { session, loading } = useAuth();
  return (
    <AppShell header={<BackHeader back="/" title="Notifications" subtitle="Offers, prizes & updates" />}>
      {!supabase ? (
        <NoBackend />
      ) : loading ? (
        <Loading />
      ) : !session ? (
        <EmptyState
          emoji="🔔"
          title="Sign in to see your notifications"
          text="Festival offers, prize alerts and updates from shops will appear here."
        >
          <Link className="btn" to="/login" style={{ display: 'inline-block', marginTop: 12 }}>
            Sign in
          </Link>
        </EmptyState>
      ) : (
        <>
          <PushCard />
          <section className="section">
            <div className="section-head">
              <h2>Inbox</h2>
            </div>
            <Inbox />
          </section>
        </>
      )}
    </AppShell>
  );
}
