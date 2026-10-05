import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../../components/Toast';
import { db, must } from '../../lib/queries';
import type { StaffRole, TeamMember, VendorRole } from '../../lib/types';
import { VENDOR_KEY } from '../api';
import { useVendor, useVendorRole } from '../context';
import { errorMessage } from '../format';
import { formatDateTime } from '../scratch/format';
import { BlockedNote, ErrorNote, Loading, PageHead } from '../ui';

const roleLabel: Record<VendorRole, string> = { owner: 'Owner', manager: 'Manager', staff: 'Staff' };
const roleClass: Record<VendorRole, string> = { owner: 'live', manager: 'approved', staff: '' };

export default function VendorTeam() {
  const vendor = useVendor();
  const { role, isOwner } = useVendorRole();
  const blocked = vendor.status === 'blocked';

  return (
    <>
      <PageHead title="Team" />
      <div className="notice">
        <b>Manager</b> can edit shops, offers and campaigns.
        <br />
        <b>Staff</b> can check prize claim codes and see insights.
        <br />
        Only the owner handles the plan, billing and the team.
      </div>
      {blocked && isOwner && <BlockedNote />}
      {isOwner && !blocked && <AddMember />}
      {role === 'staff' ? (
        <p className="meta" style={{ fontSize: 13 }}>
          You are on the {vendor.business_name} team as Staff. The owner and managers can see the full team.
        </p>
      ) : (
        !blocked && <MemberList />
      )}
      {!isOwner && <LeaveBusiness />}
    </>
  );
}

function useTeam() {
  const vendor = useVendor();
  return useQuery({
    queryKey: ['vendor', 'team', vendor.id],
    queryFn: async () => must<TeamMember[]>(await db().rpc('vendor_team')),
  });
}

function AddMember() {
  const qc = useQueryClient();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('staff');
  const [error, setError] = useState('');

  const add = useMutation({
    mutationFn: async () => must(await db().rpc('add_vendor_staff', { p_email: email.trim(), p_role: role })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vendor', 'team'] });
      toast(`Added as ${roleLabel[role]}`);
      setEmail('');
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = email.trim();
    const problem = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? 'Enter a valid email address.' : null;
    setError(problem ?? '');
    if (!problem) add.mutate();
  };

  return (
    <section className="section" style={{ marginTop: 0 }}>
      <div className="section-head">
        <h2>Add a team member</h2>
      </div>
      <form className="form-card" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="tm-email">Email *</label>
          <input
            id="tm-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
            placeholder="name@example.com"
          />
          <div className="hint">They must sign in to IWILLFLY once with this email first.</div>
        </div>
        <div className="field">
          <label htmlFor="tm-role">Role *</label>
          <select id="tm-role" value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
            <option value="staff">Staff: check prize codes, see insights</option>
            <option value="manager">Manager: edit shops, offers and campaigns</option>
          </select>
        </div>
        {error && <p className="error-text">{error}</p>}
        <button className="btn block" type="submit" disabled={add.isPending} style={{ marginTop: 4 }}>
          {add.isPending ? 'Adding…' : 'Add to team'}
        </button>
      </form>
    </section>
  );
}

function MemberList() {
  const { data, isPending, error } = useTeam();
  const { isOwner } = useVendorRole();
  return (
    <section className="section">
      <div className="section-head">
        <h2>Your team</h2>
      </div>
      {isPending ? (
        <Loading />
      ) : error ? (
        <ErrorNote error={error} />
      ) : (
        <div className="list">
          {data.map((m) => (
            <MemberRow key={m.user_id} member={m} canChange={isOwner && m.role !== 'owner'} />
          ))}
          {data.length === 1 && (
            <p className="meta" style={{ fontSize: 13, margin: 0 }}>
              It's just you so far.{isOwner ? ' Add people who help run your shops above.' : ''}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function MemberRow({ member: m, canChange }: { member: TeamMember; canChange: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { session } = useAuth();
  const who = m.full_name || m.email;

  const change = useMutation({
    mutationFn: async (role: StaffRole | null) =>
      must(await db().rpc('set_vendor_staff', { p_user_id: m.user_id, p_role: role })),
    onSuccess: (_, role) => {
      qc.invalidateQueries({ queryKey: ['vendor', 'team'] });
      toast(role ? `${who} is now ${roleLabel[role]}` : `${who} removed from the team`);
    },
    onError: (e) => toast(errorMessage(e)),
  });

  return (
    <div className="manage-card" style={{ marginTop: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
        <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          <h4>
            {who}
            {m.user_id === session?.user.id && ' (you)'}
          </h4>
          {m.full_name && <div className="meta">{m.email}</div>}
          <div className="meta">
            {m.role === 'owner' ? 'Owner since' : 'Added'} {formatDateTime(m.added_at)}
          </div>
        </div>
        <span className={`pill-status ${roleClass[m.role]}`} style={{ flex: 'none' }}>
          {roleLabel[m.role]}
        </span>
      </div>
      {canChange && (
        <div className="btn-row" style={{ alignItems: 'center' }}>
          <div className="field" style={{ margin: 0, flex: 1, minWidth: 140 }}>
            <select
              aria-label={`Role for ${who}`}
              value={m.role}
              disabled={change.isPending}
              onChange={(e) => change.mutate(e.target.value as StaffRole)}
              style={{ padding: 8 }}
            >
              <option value="manager">Manager</option>
              <option value="staff">Staff</option>
            </select>
          </div>
          <button
            type="button"
            className="btn danger small"
            disabled={change.isPending}
            onClick={() => {
              if (confirm(`Remove ${who} from your team? They lose access straight away.`))
                change.mutate(null);
            }}
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

function LeaveBusiness() {
  const vendor = useVendor();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { refreshRoles } = useAuth();

  const leave = useMutation({
    mutationFn: async () => must(await db().rpc('leave_vendor')),
    onSuccess: async () => {
      toast(`You left ${vendor.business_name}`);
      await refreshRoles();
      await qc.invalidateQueries({ queryKey: VENDOR_KEY });
      navigate('/profile', { replace: true });
    },
    onError: (e) => toast(errorMessage(e)),
  });

  return (
    <section className="section">
      <div className="btn-row">
        <button
          type="button"
          className="btn danger"
          disabled={leave.isPending}
          onClick={() => {
            if (confirm(`Leave ${vendor.business_name}? You lose access until the owner adds you again.`))
              leave.mutate();
          }}
        >
          {leave.isPending ? 'Leaving…' : 'Leave this business'}
        </button>
      </div>
    </section>
  );
}
