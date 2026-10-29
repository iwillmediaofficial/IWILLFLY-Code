import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { PasswordInput } from '../../auth/forms';
import { useToast } from '../../components/Toast';
import { suggestUsername, USERNAME_RE } from '../../lib/branchLogin';
import { db, must } from '../../lib/queries';
import { serverApi } from '../../lib/serverApi';
import type { Branch, StaffRole, TeamMember, VendorRole } from '../../lib/types';
import { useMyBranches, useMyShops, VENDOR_KEY } from '../api';
import { useBranchScope, useVendor, useVendorRole } from '../context';
import { errorMessage } from '../format';
import { formatDateTime } from '../scratch/format';
import { BlockedNote, ErrorNote, Loading, PageHead } from '../ui';
import { MapPin, MessageCircle } from 'lucide-react';
import { Icon } from '../../components/Icon';

const roleClass: Record<VendorRole, string> = { owner: 'live', manager: 'approved', staff: '' };

/** "Owner", "Manager", "Branch manager", "Branch staff" */
const roleText = (role: VendorRole, branch: boolean) =>
  role === 'owner'
    ? 'Owner'
    : branch
      ? role === 'manager'
        ? 'Branch manager'
        : 'Branch staff'
      : role === 'manager'
        ? 'Manager'
        : 'Staff';

type Invite = { id: number; token: string; branch_id: number | null; role: StaffRole; expires_at: string };

export default function VendorTeam() {
  const vendor = useVendor();
  const { role, isOwner } = useVendorRole();
  const { isBranchManager, branchName } = useBranchScope();
  const blocked = vendor.status === 'blocked';
  const canAdd = (isOwner || isBranchManager) && !blocked;

  return (
    <>
      <PageHead title={branchName ? `Team at ${branchName}` : 'Team'} />
      <div className="notice">
        {isBranchManager ? (
          <>
            You can add <b>branch staff</b> for {branchName}: they check prize claim codes. The business owner
            adds managers.
          </>
        ) : (
          <>
            <b>Manager</b> can edit shops, offers and campaigns. <b>Staff</b> can check prize claim codes and
            see insights.
            <br />
            <b>Branch manager</b> runs one branch: its details and its own offers. <b>Branch staff</b> check
            prize codes at that branch.
            <br />
            Only the owner handles the plan, billing and the team.
          </>
        )}
      </div>
      {blocked && isOwner && <BlockedNote />}
      {canAdd && <AddMember />}
      {canAdd && <OpenInvites />}
      {role === 'staff' ? (
        <p className="meta" style={{ fontSize: 13 }}>
          You are on the {vendor.business_name} team as Staff. The owner and managers can see the full team.
        </p>
      ) : (
        !blocked && <MemberList />
      )}
      {!isOwner && !vendor.my_login_name && <LeaveBusiness />}
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

/** Branch picker data: every branch with its shop name when the vendor has more than one shop. */
function useBranchOptions() {
  const branches = useMyBranches().data ?? [];
  const shops = useMyShops().data ?? [];
  const label = (b: Branch) =>
    shops.length > 1 ? `${shops.find((s) => s.id === b.shop_id)?.name ?? ''} · ${b.name}` : b.name;
  return { branches: branches.filter((b) => b.review_status !== 'rejected'), shops, label };
}

type Method = 'username' | 'link' | 'email';

function AddMember() {
  const qc = useQueryClient();
  const toast = useToast();
  const { isOwner } = useVendorRole();
  const { branchId: myBranch } = useBranchScope();
  const { branches, shops, label } = useBranchOptions();
  const [method, setMethod] = useState<Method>('username');
  // '' = whole business (owner only)
  const [branch, setBranch] = useState<string>(myBranch != null ? String(myBranch) : '');
  const [role, setRole] = useState<StaffRole>(isOwner ? 'manager' : 'staff');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [made, setMade] = useState<{ username: string; password: string; branch: string } | null>(null);
  const [link, setLink] = useState<{ url: string; text: string } | null>(null);

  const branchId = branch ? Number(branch) : null;
  const chosen = branches.find((b) => b.id === branchId);
  const whoFor = chosen ? label(chosen) : 'the whole business';
  const roleName = roleText(role, branchId != null);
  const needsBranch = method === 'username' && branchId == null;
  const done = () => {
    qc.invalidateQueries({ queryKey: ['vendor', 'team'] });
    qc.invalidateQueries({ queryKey: ['vendor', 'invites'] });
  };

  const pickBranch = (v: string) => {
    setBranch(v);
    const b = branches.find((x) => x.id === Number(v));
    const shop = shops.find((s) => s.id === b?.shop_id);
    if (b && shop && (!username || USERNAME_RE.test(username)))
      setUsername(suggestUsername(shop.slug, b.slug));
  };

  const add = useMutation({
    mutationFn: async () => {
      if (method === 'email') {
        must(
          await db().rpc('add_vendor_staff', { p_email: email.trim(), p_role: role, p_branch_id: branchId }),
        );
        return null;
      }
      if (method === 'username') {
        await serverApi('/api/vendor/branch-login', {
          branch_id: branchId,
          username: username.trim().toLowerCase(),
          password,
          full_name: name.trim(),
          role,
        });
        return null;
      }
      return must<string>(await db().rpc('create_vendor_invite', { p_role: role, p_branch_id: branchId }));
    },
    onSuccess: (token) => {
      done();
      setError('');
      if (method === 'email') {
        toast(`Added as ${roleName}`);
        setEmail('');
      } else if (method === 'username') {
        setMade({ username: username.trim().toLowerCase(), password, branch: whoFor });
        setPassword('');
        setName('');
      } else if (token) {
        const url = `${window.location.origin}/vendor/join/${token}`;
        setLink({
          url,
          text: `You're invited to join ${whoFor} on IWILLFLY as ${roleName}. Open this link, sign in or sign up, and tap Join: ${url}`,
        });
      }
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    let problem: string | null = null;
    if (method === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      problem = 'Enter a valid email address.';
    if (method === 'username') {
      if (branchId == null) problem = 'Username logins are for a branch. Choose the branch.';
      else if (!USERNAME_RE.test(username.trim().toLowerCase()))
        problem = 'Username: 3 to 30 letters, numbers, dots, dashes or underscores.';
      else if (password.length < 8 || password.length > 72) problem = 'Password must be 8 to 72 characters.';
    }
    setError(problem ?? '');
    setMade(null);
    setLink(null);
    if (!problem) add.mutate();
  };

  const tabs: { key: Method; label: string }[] = [
    { key: 'username', label: 'Username + password' },
    { key: 'link', label: 'WhatsApp invite link' },
    { key: 'email', label: 'Email' },
  ];

  return (
    <section className="section" style={{ marginTop: 0 }}>
      <div className="section-head">
        <h2>Add a team member</h2>
      </div>
      <form className="form-card" onSubmit={submit} noValidate>
        <div className="tabs wrap" role="tablist" style={{ marginBottom: 12 }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={method === t.key}
              className={method === t.key ? 'active' : ''}
              onClick={() => {
                setMethod(t.key);
                setError('');
                setMade(null);
                setLink(null);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="meta" style={{ marginTop: 0 }}>
          {method === 'username'
            ? 'You choose a username and password and give them to the branch manager. No email needed.'
            : method === 'link'
              ? 'Send the link on WhatsApp. They open it, sign in or sign up, and join. The link works once, for 7 days.'
              : 'They must have signed in to IWILLFLY once with this email.'}
        </p>
        {isOwner ? (
          <div className="field-row">
            <div className="field">
              <label htmlFor="tm-branch">Works at *</label>
              <select id="tm-branch" value={branch} onChange={(e) => pickBranch(e.target.value)}>
                {method !== 'username' && <option value="">The whole business</option>}
                {method === 'username' && branchId == null && <option value="">Choose a branch</option>}
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {label(b)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="tm-role">Role *</label>
              <select id="tm-role" value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
                <option value="manager">
                  {branchId != null
                    ? 'Branch manager: branch details and its offers'
                    : 'Manager: shops, offers, campaigns'}
                </option>
                <option value="staff">Staff: check prize codes</option>
              </select>
            </div>
          </div>
        ) : (
          <p className="meta">Adds branch staff for {whoFor}.</p>
        )}
        {method === 'email' && (
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
          </div>
        )}
        {method === 'username' && !needsBranch && (
          <>
            <div className="field">
              <label htmlFor="tm-user">Username *</label>
              <input
                id="tm-user"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                autoComplete="off"
                autoCapitalize="none"
                maxLength={30}
                placeholder="e.g. lulu-kakkanad"
              />
              <div className="hint">They sign in at the vendor sign-in page with this username.</div>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="tm-pass">Password *</label>
                <PasswordInput
                  id="tm-pass"
                  autoComplete="new-password"
                  value={password}
                  onChange={setPassword}
                />
              </div>
              <div className="field">
                <label htmlFor="tm-name">Person's name</label>
                <input id="tm-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
              </div>
            </div>
          </>
        )}
        {error && <p className="error-text">{error}</p>}
        <button className="btn block" type="submit" disabled={add.isPending} style={{ marginTop: 4 }}>
          {add.isPending
            ? 'Working…'
            : method === 'username'
              ? 'Create login'
              : method === 'link'
                ? 'Make invite link'
                : 'Add to team'}
        </button>
        {made && <LoginMade {...made} />}
        {link && <ShareLink {...link} />}
      </form>
    </section>
  );
}

/** Shown once after a username login is made, so the owner can pass it on. */
function LoginMade({ username, password, branch }: { username: string; password: string; branch: string }) {
  const text = `Your IWILLFLY login for ${branch}:\nUsername: ${username}\nPassword: ${password}\nSign in at ${window.location.origin}/vendor/login`;
  return (
    <div className="notice" style={{ marginTop: 12 }}>
      <b>Login created for {branch}.</b>
      <br />
      Username: <b>{username}</b>
      <br />
      Password: <b>{password}</b>
      <br />
      <span className="meta">
        Give these to the branch manager. You can change the password later from the team list.
      </span>
      <ShareButtons text={text} />
    </div>
  );
}

function ShareLink({ url, text }: { url: string; text: string }) {
  return (
    <div className="notice" style={{ marginTop: 12, overflowWrap: 'anywhere' }}>
      <b>Invite link ready.</b>
      <br />
      <span className="meta">{url}</span>
      <ShareButtons text={text} copyText={url} />
    </div>
  );
}

function ShareButtons({ text, copyText }: { text: string; copyText?: string }) {
  const toast = useToast();
  return (
    <div className="btn-row">
      <a
        className="btn small"
        href={`https://wa.me/?text=${encodeURIComponent(text)}`}
        target="_blank"
        rel="noreferrer"
      >
        <Icon icon={MessageCircle} /> Send on WhatsApp
      </a>
      <button
        type="button"
        className="btn secondary small"
        onClick={() =>
          navigator.clipboard?.writeText(copyText ?? text).then(
            () => toast('Copied'),
            () => toast(copyText ?? text),
          )
        }
      >
        Copy
      </button>
    </div>
  );
}

/** Invite links not used yet, with a way to cancel them. */
function OpenInvites() {
  const vendor = useVendor();
  const qc = useQueryClient();
  const toast = useToast();
  const { branches, label } = useBranchOptions();
  const invites = useQuery({
    queryKey: ['vendor', 'invites', vendor.id],
    queryFn: async () =>
      must<Invite[]>(
        await db()
          .from('vendor_invites')
          .select('id, token, branch_id, role, expires_at')
          .eq('vendor_id', vendor.id)
          .is('used_at', null)
          .is('revoked_at', null)
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false }),
      ),
  });
  const revoke = useMutation({
    mutationFn: async (id: number) => must(await db().rpc('revoke_vendor_invite', { p_id: id })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vendor', 'invites'] });
      toast('Invite link cancelled');
    },
    onError: (e) => toast(errorMessage(e)),
  });
  if (!invites.data?.length) return null;
  return (
    <section className="section">
      <div className="section-head">
        <h2>Invite links not used yet</h2>
      </div>
      <div className="list">
        {invites.data.map((i) => {
          const b = branches.find((x) => x.id === i.branch_id);
          return (
            <div key={i.id} className="manage-card" style={{ marginTop: 0 }}>
              <h4>
                {roleText(i.role, i.branch_id != null)} · {b ? label(b) : 'whole business'}
              </h4>
              <div className="meta">Works until {formatDateTime(i.expires_at)}</div>
              <div className="btn-row">
                <ShareButtons
                  text={`Join ${b ? label(b) : vendor.business_name} on IWILLFLY: ${window.location.origin}/vendor/join/${i.token}`}
                  copyText={`${window.location.origin}/vendor/join/${i.token}`}
                />
                <button
                  type="button"
                  className="btn danger small"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(i.id)}
                >
                  Cancel link
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MemberList() {
  const { data, isPending, error } = useTeam();
  const { isOwner } = useVendorRole();
  const { branchId: myBranch, isBranchManager } = useBranchScope();
  const [filter, setFilter] = useState('');
  const { branches, label } = useBranchOptions();
  const shown = (data ?? []).filter(
    (m) => !filter || String(m.branch_id ?? '') === filter || m.role === 'owner',
  );
  return (
    <section className="section">
      <div className="section-head">
        <h2>Your team</h2>
        {isOwner && branches.length > 1 && (data?.length ?? 0) > 5 && (
          <select
            aria-label="Show branch"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ padding: 6, maxWidth: 180 }}
          >
            <option value="">Everyone</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {label(b)}
              </option>
            ))}
          </select>
        )}
      </div>
      {isPending ? (
        <Loading />
      ) : error ? (
        <ErrorNote error={error} />
      ) : (
        <div className="list">
          {shown.map((m) => (
            <MemberRow
              key={m.user_id}
              member={m}
              canChange={isOwner && m.role !== 'owner'}
              // A branch manager can remove their branch's staff.
              canRemove={
                (isOwner && m.role !== 'owner') ||
                (isBranchManager && m.role === 'staff' && m.branch_id === myBranch)
              }
            />
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

function MemberRow({
  member: m,
  canChange,
  canRemove,
}: {
  member: TeamMember;
  canChange: boolean;
  canRemove: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { session } = useAuth();
  const { branches, label } = useBranchOptions();
  const who = m.full_name || m.login_name || m.email;
  const refresh = () => qc.invalidateQueries({ queryKey: ['vendor', 'team'] });

  const change = useMutation({
    mutationFn: async (to: { role: StaffRole | null; branch?: number | null }) =>
      must(
        await db().rpc('set_vendor_staff', {
          p_user_id: m.user_id,
          p_role: to.role,
          p_branch_id: to.branch ?? null,
          p_keep_branch: to.branch === undefined,
        }),
      ),
    onSuccess: (_, to) => {
      refresh();
      toast(to.role ? `${who} updated` : `${who} removed from the team`);
    },
    onError: (e) => toast(errorMessage(e)),
  });

  const password = useMutation({
    mutationFn: async (p: string) =>
      serverApi('/api/vendor/branch-login/password', { user_id: m.user_id, password: p }),
    onSuccess: () => toast(`New password set for ${m.login_name}`),
    onError: (e) => toast(errorMessage(e)),
  });

  const active = useMutation({
    mutationFn: async (on: boolean) =>
      serverApi('/api/vendor/branch-login/active', { user_id: m.user_id, active: on }),
    onSuccess: (_, on) => {
      refresh();
      toast(on ? `${m.login_name} can sign in again` : `${m.login_name} is switched off`);
    },
    onError: (e) => toast(errorMessage(e)),
  });

  const busy = change.isPending || password.isPending || active.isPending;
  // Username logins of the owner's team, or a branch manager's own staff, can be reset and switched off.
  const manageLogin = m.login_name != null && (canChange || canRemove);

  return (
    <div className="manage-card" style={{ marginTop: 0, opacity: m.disabled ? 0.7 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
        <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          <h4>
            {who}
            {m.user_id === session?.user.id && ' (you)'}
          </h4>
          {m.login_name ? (
            <div className="meta">Username: {m.login_name}</div>
          ) : (
            m.full_name && m.email && <div className="meta">{m.email}</div>
          )}
          {m.branch_name && (
            <div className="meta">
              <Icon icon={MapPin} /> {m.branch_name}
            </div>
          )}
          <div className="meta">
            {m.role === 'owner' ? 'Owner since' : 'Added'} {formatDateTime(m.added_at)}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'end', flex: 'none' }}>
          <span className={`pill-status ${roleClass[m.role]}`}>{roleText(m.role, m.branch_id != null)}</span>
          {m.disabled && <span className="pill-status rejected">Switched off</span>}
        </div>
      </div>
      {canChange && (
        <div className="field-row" style={{ marginTop: 10 }}>
          <div className="field" style={{ margin: 0 }}>
            <select
              aria-label={`Branch for ${who}`}
              value={m.branch_id ?? ''}
              disabled={busy}
              onChange={(e) =>
                change.mutate({
                  role: m.role as StaffRole,
                  branch: e.target.value ? Number(e.target.value) : null,
                })
              }
              style={{ padding: 8 }}
            >
              {/* Username logins always belong to a branch. */}
              {!m.login_name && <option value="">Whole business</option>}
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {label(b)}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <select
              aria-label={`Role for ${who}`}
              value={m.role}
              disabled={busy}
              onChange={(e) => change.mutate({ role: e.target.value as StaffRole })}
              style={{ padding: 8 }}
            >
              <option value="manager">{m.branch_id != null ? 'Branch manager' : 'Manager'}</option>
              <option value="staff">{m.branch_id != null ? 'Branch staff' : 'Staff'}</option>
            </select>
          </div>
        </div>
      )}
      {(canRemove || manageLogin) && (
        <div className="btn-row" style={{ alignItems: 'center' }}>
          {manageLogin && (
            <button
              type="button"
              className="btn secondary small"
              disabled={busy}
              onClick={() => {
                const p = prompt(`New password for ${m.login_name} (8 to 72 characters)`);
                if (p == null) return;
                if (p.length < 8 || p.length > 72) return toast('Password must be 8 to 72 characters');
                password.mutate(p);
              }}
            >
              Change password
            </button>
          )}
          {manageLogin && (
            <button
              type="button"
              className="btn secondary small"
              disabled={busy}
              onClick={() => {
                if (
                  m.disabled ||
                  confirm(`Switch off ${m.login_name}? They can't sign in until you switch it on.`)
                )
                  active.mutate(m.disabled);
              }}
            >
              {m.disabled ? 'Switch on' : 'Switch off'}
            </button>
          )}
          {canRemove && (
            <button
              type="button"
              className="btn danger small"
              disabled={busy}
              onClick={() => {
                if (confirm(`Remove ${who} from your team? They lose access straight away.`))
                  change.mutate({ role: null });
              }}
            >
              Remove
            </button>
          )}
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
