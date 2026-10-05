import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useAuth, type AppRole } from '../../auth/AuthProvider';
import { useToast } from '../../components/Toast';
import { db, must } from '../../lib/queries';
import type { StaffMember } from '../../lib/types';
import { Empty, ErrorNotice, Loading } from '../ui';
import { formatDate, useInvalidate } from '../util';

type StaffRole = Extract<AppRole, 'super_admin' | 'admin' | 'support' | 'campaign_manager'>;

const ROLES: { key: StaffRole; label: string; help: string }[] = [
  { key: 'super_admin', label: 'Super admin', help: 'Everything, including adding and removing admins.' },
  { key: 'admin', label: 'Admin', help: 'Everything except managing admins and super admins.' },
  { key: 'support', label: 'Support', help: 'Answers help tickets and can read invoices.' },
  {
    key: 'campaign_manager',
    label: 'Campaign manager',
    help: 'Scratch & Win, festivals, home ads, requests and notifications.',
  },
];

const roleLabel = (r: string) => ROLES.find((x) => x.key === r)?.label ?? r;
const TEAM_KEY = ['admin-team'];

export default function Team() {
  const { roles } = useAuth();
  const isSuper = roles.includes('super_admin');
  const team = useQuery({
    queryKey: TEAM_KEY,
    queryFn: async () => must<StaffMember[]>(await db().rpc('admin_team')),
  });

  return (
    <>
      <div className="section-head">
        <h2>Team</h2>
      </div>
      <div className="manage-card" style={{ fontSize: 13 }}>
        {ROLES.map((r) => (
          <div key={r.key} style={{ marginBottom: 4 }}>
            <b>{r.label}:</b> {r.help}
          </div>
        ))}
      </div>
      <GrantForm isSuper={isSuper} />
      <div className="section-head" style={{ marginTop: 18 }}>
        <h2>People</h2>
      </div>
      {team.isPending && <Loading />}
      {team.error && <ErrorNotice error={team.error} />}
      {team.data?.length === 0 && <Empty emoji="👥" title="No staff yet" />}
      {team.data?.map((m) => (
        <MemberCard key={m.user_id} member={m} isSuper={isSuper} />
      ))}
    </>
  );
}

function GrantForm({ isSuper }: { isSuper: boolean }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const options = ROLES.filter((r) => isSuper || (r.key !== 'admin' && r.key !== 'super_admin'));
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('support');
  const [error, setError] = useState('');

  const grant = useMutation({
    mutationFn: async () => must(await db().rpc('grant_staff_role', { p_email: email.trim(), p_role: role })),
    onSuccess: () => {
      invalidate(TEAM_KEY);
      toast(`${email.trim()} is now ${roleLabel(role)}`);
      setEmail('');
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        /No account uses that email/i.test(msg)
          ? 'Nobody has signed in with that email yet. Ask them to sign in once first.'
          : msg,
      );
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter their email address.');
    if (
      (role === 'admin' || role === 'super_admin') &&
      !window.confirm(`Make ${email.trim()} a ${roleLabel(role)}? They can change almost everything.`)
    )
      return;
    grant.mutate();
  };

  return (
    <form className="form-card" onSubmit={submit} style={{ marginTop: 12 }}>
      <h3 style={{ marginTop: 0 }}>Add someone</h3>
      <div className="notice">
        The person must sign in once (or be created in Supabase &gt; Authentication &gt; Users) before you can
        add them. Admins sign in at /admin/login with a password.
      </div>
      <div className="field">
        <label htmlFor="tm-email">Email</label>
        <input
          id="tm-email"
          type="email"
          autoCapitalize="none"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="tm-role">Role</label>
        <select id="tm-role" value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
          {options.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
        <div className="hint">{ROLES.find((r) => r.key === role)?.help}</div>
      </div>
      {error && <p className="error-text">{error}</p>}
      <div className="btn-row">
        <button className="btn" type="submit" disabled={grant.isPending}>
          {grant.isPending ? 'Adding…' : 'Add role'}
        </button>
      </div>
    </form>
  );
}

function MemberCard({ member: m, isSuper }: { member: StaffMember; isSuper: boolean }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const { session, refreshRoles } = useAuth();
  const isMe = session?.user.id === m.user_id;

  const revoke = useMutation({
    mutationFn: async (role: string) =>
      must(await db().from('user_roles').delete().eq('user_id', m.user_id).eq('role', role)),
    onSuccess: async (_, role) => {
      invalidate(TEAM_KEY);
      toast(`${roleLabel(role)} role removed`);
      if (isMe) await refreshRoles();
    },
    onError: (e) => toast(e instanceof Error ? e.message : String(e)),
  });

  const remove = (role: string) => {
    const powerful = role === 'admin' || role === 'super_admin';
    const msg =
      isMe && powerful
        ? `Remove your own ${roleLabel(role)} role?\n\nYou may lose access to this page straight away, and only ` +
          'a super admin can give it back.'
        : `Remove the ${roleLabel(role)} role from ${m.email}?`;
    if (window.confirm(msg)) revoke.mutate(role);
  };

  return (
    <div className="manage-card">
      <h4>
        {m.full_name ?? m.email}
        {isMe && <span className="meta"> (you)</span>}
      </h4>
      <div className="meta">
        {m.full_name ? `${m.email} · ` : ''}
        {m.last_sign_in_at ? `last signed in ${formatDate(m.last_sign_in_at)}` : 'never signed in'}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        {m.roles.map((r) => {
          const canRemove = isSuper || (r !== 'admin' && r !== 'super_admin');
          return (
            <span
              key={r}
              className={`pill-status ${r === 'super_admin' || r === 'admin' ? 'featured' : 'live'}`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              {roleLabel(r)}
              {canRemove && (
                <button
                  type="button"
                  aria-label={`Remove ${roleLabel(r)} role`}
                  title="Remove this role"
                  disabled={revoke.isPending}
                  onClick={() => remove(r)}
                  style={{
                    border: 0,
                    background: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    color: 'inherit',
                    font: 'inherit',
                    lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
