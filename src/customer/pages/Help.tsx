import { Link, Route, Routes } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { AppShell, BackHeader } from '../../components/AppShell';
import { EmptyState } from '../../components/ShopCard';
import { customerScope } from '../../components/support/api';
import { NewTicket } from '../../components/support/NewTicket';
import { TicketList } from '../../components/support/TicketList';
import { TicketThread } from '../../components/support/TicketThread';
import { supabase } from '../../lib/supabase';
import { Loading, NoBackend } from '../ui';

/** /help, /help/new and /help/:id for any signed-in person. */
export default function Help() {
  const { session, loading } = useAuth();
  return (
    <AppShell
      header={<BackHeader back="/profile" title="Help & support" subtitle="Talk to the IWILLFLY team" />}
    >
      {!supabase ? (
        <NoBackend />
      ) : loading ? (
        <Loading />
      ) : !session ? (
        <EmptyState
          emoji="💬"
          title="Sign in to contact support"
          text="Your questions and our replies are kept here."
        >
          <Link className="btn" to="/login" style={{ display: 'inline-block', marginTop: 12 }}>
            Sign in
          </Link>
        </EmptyState>
      ) : (
        <Routes>
          <Route index element={<TicketList scope={customerScope} />} />
          <Route path="new" element={<NewTicket scope={customerScope} />} />
          <Route path=":id" element={<TicketThread scope={customerScope} />} />
        </Routes>
      )}
    </AppShell>
  );
}
