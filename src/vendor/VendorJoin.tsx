import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { AppShell, LogoHeader } from '../components/AppShell';
import { db, must } from '../lib/queries';
import { VENDOR_KEY } from './api';
import { errorMessage } from './format';
import { ErrorNote, Loading } from './ui';

type InviteInfo = {
  business_name: string;
  shop_name: string | null;
  branch_name: string | null;
  role: 'manager' | 'staff';
  state: 'ok' | 'used' | 'expired' | 'revoked';
};

/** /vendor/join/<token>: an invite link sent by a shop owner (usually on WhatsApp). */
export default function VendorJoin() {
  const token = useParams().token ?? '';
  const { session, refreshRoles, signOut } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const info = useQuery({
    queryKey: ['vendor-invite', token],
    queryFn: async () => must<InviteInfo | null>(await db().rpc('vendor_invite_info', { p_token: token })),
    enabled: /^[0-9a-f]{64}$/.test(token),
  });
  const join = useMutation({
    mutationFn: async () => must(await db().rpc('accept_vendor_invite', { p_token: token })),
    onSuccess: async () => {
      await refreshRoles();
      await qc.invalidateQueries({ queryKey: VENDOR_KEY });
      navigate('/vendor', { replace: true });
    },
  });
  const i = info.data;
  const place = i ? [i.shop_name, i.branch_name].filter(Boolean).join(' · ') || i.business_name : '';
  const role = i
    ? i.branch_name
      ? i.role === 'manager'
        ? 'Branch manager'
        : 'Branch staff'
      : i.role === 'manager'
        ? 'Manager'
        : 'Staff'
    : '';

  return (
    <AppShell header={<LogoHeader />}>
      <section className="hero">
        <h1>Join a shop team</h1>
        <p>You were invited to help run a shop on IWILLFLY.</p>
        <span className="hero-pill">Team invite</span>
      </section>
      <section className="section form-card">
        {info.isPending && info.fetchStatus !== 'idle' ? (
          <Loading />
        ) : info.error ? (
          <ErrorNote error={info.error} />
        ) : !i || i.state !== 'ok' ? (
          <div className="notice bad">
            {!i
              ? 'This invite link is not valid.'
              : i.state === 'used'
                ? 'This invite link was already used.'
                : 'This invite link has expired or was cancelled.'}{' '}
            Ask the shop owner for a new one.
          </div>
        ) : (
          <>
            <p style={{ marginTop: 0 }}>
              <b>{i.business_name}</b> invited you to join <b>{place}</b> as <b>{role}</b>.
            </p>
            <p className="meta">
              You are signed in as {session?.user.email}. Join with this account, or sign out and use another
              one.
            </p>
            {join.error && <p className="error-text">{errorMessage(join.error)}</p>}
            <button className="btn block" disabled={join.isPending} onClick={() => join.mutate()}>
              {join.isPending ? 'Joining…' : 'Join the team'}
            </button>
            <button className="btn secondary block" style={{ marginTop: 8 }} onClick={signOut}>
              Sign out and use a different account
            </button>
          </>
        )}
      </section>
      <p className="meta" style={{ textAlign: 'center' }}>
        <Link to="/">Back to IWILLFLY</Link>
      </p>
    </AppShell>
  );
}
