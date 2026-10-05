import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useToast } from '../components/Toast';
import { db, must, useCategories } from '../lib/queries';
import { PasswordInput } from '../auth/forms';
import type { Offer, Vendor, VendorStatus } from '../lib/types';
import { formatDate as formatDay, offerPhase, phaseClass, phaseLabel, phoneError } from '../vendor/format';
import { ErrorNotice, Loading } from './ui';
import { PUBLIC_KEYS, formatDate, friendlyError, one, useInvalidate } from './util';
import { DIRECTORY_KEY, adminApi, useVendorDirectory, type VendorOwnerRow } from './vendorApi';

type ShopRow = {
  id: number;
  name: string;
  description: string | null;
  phone: string | null;
  whatsapp: string | null;
  is_active: boolean;
  category_id: number | null;
  category: { name: string; icon: string | null } | { name: string; icon: string | null }[] | null;
  branches: { count: number }[];
  offers: Offer[];
};

const SHOPS_SELECT =
  'id, name, description, phone, whatsapp, is_active, category_id, category:categories(name, icon), branches(count), offers(*)';

function useVendorShops(vendorId: number) {
  return useQuery({
    queryKey: ['admin', 'vendor', vendorId, 'shops'],
    queryFn: async () =>
      must<ShopRow[]>(
        await db().from('shops').select(SHOPS_SELECT).eq('vendor_id', vendorId).order('created_at'),
      ),
  });
}

type TeamRow = { user_id: string; email: string; full_name: string | null; role: string; added_at: string };

const VENDOR_KEYS = (id: number) => [
  ['admin', 'vendor', id],
  ['admin', 'vendors'],
  DIRECTORY_KEY,
  ['admin_stats'],
];

/** Everything about one vendor: business, owner, team, shops and plan, all editable by admins. */
export function VendorDetail() {
  const { id } = useParams();
  const vendorId = Number(id);
  const { roles } = useAuth();
  const isSuper = roles.includes('super_admin');
  const directory = useVendorDirectory();
  const owner = directory.data?.get(vendorId);

  const vendor = useQuery({
    queryKey: ['admin', 'vendor', vendorId],
    queryFn: async () => must<Vendor>(await db().from('vendors').select('*').eq('id', vendorId).single()),
    enabled: Number.isFinite(vendorId),
  });

  return (
    <>
      <div className="section-head">
        <h2>{vendor.data?.business_name ?? 'Vendor'}</h2>
        <Link to="/admin/vendors?status=all">‹ All vendors</Link>
      </div>
      {vendor.isPending && <Loading />}
      {vendor.error && <ErrorNotice error={vendor.error} />}
      {vendor.data && (
        <>
          <BusinessCard key={vendor.dataUpdatedAt} vendor={vendor.data} />
          {directory.error && <ErrorNotice error={directory.error} />}
          {owner && <OwnerCard key={`${owner.owner_name}|${owner.owner_phone}`} owner={owner} />}
          {isSuper && <PasswordCard vendorId={vendorId} />}
          <TeamCard vendorId={vendorId} />
          <ShopsCard vendorId={vendorId} />
          <OffersCard vendorId={vendorId} />
          <PlanCard vendorId={vendorId} invoices={owner?.invoice_count ?? 0} />
          {isSuper && <DeleteCard vendor={vendor.data} invoices={owner?.invoice_count ?? 0} />}
        </>
      )}
    </>
  );
}

function BusinessCard({ vendor: v }: { vendor: Vendor }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [name, setName] = useState(v.business_name);
  const [phone, setPhone] = useState(v.contact_phone ?? '');
  const [whatsapp, setWhatsapp] = useState(v.whatsapp ?? '');
  const [status, setStatus] = useState<VendorStatus>(v.status);
  const [verified, setVerified] = useState(v.is_verified);
  const [note, setNote] = useState(v.admin_note ?? '');
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: async () => {
      must(
        await db()
          .from('vendors')
          .update({
            business_name: name.trim(),
            contact_phone: phone.trim() || null,
            whatsapp: whatsapp.trim() || null,
            status,
            is_verified: verified,
            admin_note: note.trim() || null,
          })
          .eq('id', v.id),
      );
    },
    onSuccess: () => {
      invalidate(...VENDOR_KEYS(v.id), ...PUBLIC_KEYS);
      toast('Business details saved');
    },
    onError: (e) => setError(friendlyError(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    const problem =
      (n.length < 2 || n.length > 120 ? 'Business name should be 2 to 120 characters.' : null) ??
      phoneError(phone) ??
      phoneError(whatsapp, 'WhatsApp');
    setError(problem ?? '');
    if (!problem) save.mutate();
  };

  return (
    <form className="form-card section" onSubmit={submit} noValidate>
      <h3 style={{ marginTop: 0 }}>🏪 Business</h3>
      <div className="field">
        <label htmlFor="v-name">Business name *</label>
        <input id="v-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="v-phone">Phone</label>
          <input
            id="v-phone"
            type="tel"
            value={phone}
            maxLength={20}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="v-wa">WhatsApp</label>
          <input
            id="v-wa"
            type="tel"
            value={whatsapp}
            maxLength={20}
            onChange={(e) => setWhatsapp(e.target.value)}
          />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="v-status">Status</label>
          <select id="v-status" value={status} onChange={(e) => setStatus(e.target.value as VendorStatus)}>
            <option value="pending">Pending review</option>
            <option value="approved">Approved (shops visible)</option>
            <option value="blocked">Blocked (shops hidden)</option>
          </select>
        </div>
        <div className="field">
          <label>Badge</label>
          <label
            className="meta"
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0' }}
          >
            <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />✓
            Verified business
          </label>
        </div>
      </div>
      <div className="field">
        <label htmlFor="v-note">Admin note (only admins see this)</label>
        <textarea id="v-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </div>
      <p className="meta">
        Applied {formatDate(v.created_at)}
        {v.reviewed_at ? ` · status last changed ${formatDate(v.reviewed_at)}` : ''}
      </p>
      {error && <p className="error-text">{error}</p>}
      <button className="btn" type="submit" disabled={save.isPending}>
        {save.isPending ? 'Saving…' : 'Save business'}
      </button>
    </form>
  );
}

function OwnerCard({ owner }: { owner: VendorOwnerRow }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [name, setName] = useState(owner.owner_name ?? '');
  const [phone, setPhone] = useState(owner.owner_phone ?? '');
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: async () => {
      must(
        await db().rpc('admin_update_vendor_owner', {
          p_vendor_id: owner.vendor_id,
          p_full_name: name.trim(),
          p_phone: phone.trim(),
        }),
      );
    },
    onSuccess: () => {
      invalidate(DIRECTORY_KEY);
      toast('Owner details saved');
    },
    onError: (e) => setError(friendlyError(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = name.trim().length > 120 ? 'Name is too long.' : phoneError(phone, 'Mobile');
    setError(problem ?? '');
    if (!problem) save.mutate();
  };

  return (
    <form className="form-card section" onSubmit={submit} noValidate>
      <h3 style={{ marginTop: 0 }}>👤 Owner</h3>
      <p className="meta" style={{ marginTop: 0 }}>
        <b>{owner.owner_email}</b> · signed up {formatDate(owner.owner_since)}
      </p>
      <div className="field-row">
        <div className="field">
          <label htmlFor="o-name">Name</label>
          <input id="o-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="o-phone">Mobile</label>
          <input
            id="o-phone"
            type="tel"
            value={phone}
            maxLength={20}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
      </div>
      <p className="meta">The email is the owner's sign-in and can only be changed by them.</p>
      {error && <p className="error-text">{error}</p>}
      <button className="btn" type="submit" disabled={save.isPending}>
        {save.isPending ? 'Saving…' : 'Save owner'}
      </button>
    </form>
  );
}

function TeamCard({ vendorId }: { vendorId: number }) {
  const team = useQuery({
    queryKey: ['admin', 'vendor', vendorId, 'team'],
    queryFn: async () => must<TeamRow[]>(await db().rpc('admin_vendor_team', { p_vendor_id: vendorId })),
  });
  return (
    <section className="form-card section">
      <h3 style={{ marginTop: 0 }}>👥 Team</h3>
      {team.isPending && <Loading />}
      {team.error && <ErrorNotice error={team.error} />}
      {team.data?.length === 0 && (
        <p className="meta">No managers or staff. The owner manages this business.</p>
      )}
      {team.data?.map((m) => (
        <div key={m.user_id} className="meta" style={{ padding: '4px 0' }}>
          <b>{m.full_name ?? m.email}</b> · {m.role}
          {m.full_name ? ` · ${m.email}` : ''} · added {formatDate(m.added_at)}
        </div>
      ))}
    </section>
  );
}

function ShopsCard({ vendorId }: { vendorId: number }) {
  const shops = useVendorShops(vendorId);
  return (
    <section className="form-card section">
      <h3 style={{ marginTop: 0 }}>🏬 Shops</h3>
      {shops.isPending && <Loading />}
      {shops.error && <ErrorNotice error={shops.error} />}
      {shops.data?.length === 0 && <p className="meta">No shops yet.</p>}
      {shops.data?.map((s) => (
        <ShopRowCard key={s.id} vendorId={vendorId} shop={s} />
      ))}
      {Boolean(shops.data?.length) && (
        <p className="meta" style={{ marginBottom: 0 }}>
          New and changed offers are reviewed in <Link to="/admin/offers">Admin → Offers</Link>.
        </p>
      )}
    </section>
  );
}

function ShopRowCard({ vendorId, shop: s }: { vendorId: number; shop: ShopRow }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data: categories = [] } = useCategories();
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({
    name: s.name,
    category_id: s.category_id,
    phone: s.phone ?? '',
    whatsapp: s.whatsapp ?? '',
    description: s.description ?? '',
    is_active: s.is_active,
  });
  const [error, setError] = useState('');
  const c = one(s.category);
  const live = s.offers.filter((o) => o.status === 'approved' && !o.is_paused).length;
  const pending = s.offers.filter((o) => o.status === 'pending').length;
  const branches = s.branches[0]?.count ?? 0;
  const keys = () => invalidate(['admin', 'vendor', vendorId, 'shops'], DIRECTORY_KEY, ...PUBLIC_KEYS);

  const save = useMutation({
    mutationFn: async () => {
      must(
        await db()
          .from('shops')
          .update({
            name: f.name.trim(),
            category_id: f.category_id,
            phone: f.phone.trim() || null,
            whatsapp: f.whatsapp.trim() || null,
            description: f.description.trim() || null,
            is_active: f.is_active,
          })
          .eq('id', s.id),
      );
    },
    onSuccess: () => {
      keys();
      setEditing(false);
      toast('Shop saved');
    },
    onError: (e) => setError(friendlyError(e)),
  });

  const remove = useMutation({
    mutationFn: async () => {
      must(await db().from('shops').delete().eq('id', s.id));
    },
    onSuccess: () => {
      keys();
      toast('Shop deleted');
    },
    onError: (e) => toast(friendlyError(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = f.name.trim();
    const problem =
      (n.length < 2 || n.length > 120 ? 'Shop name should be 2 to 120 characters.' : null) ??
      (f.description.length > 1000 ? 'Description is too long.' : null) ??
      phoneError(f.phone) ??
      phoneError(f.whatsapp, 'WhatsApp');
    setError(problem ?? '');
    if (!problem) save.mutate();
  };

  return (
    <div className="manage-card">
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div className="grow">
          <h4>{s.name}</h4>
          <div className="meta">
            {c ? `${c.icon ?? ''} ${c.name}` : 'No category'} · {branches} branch{branches === 1 ? '' : 'es'}{' '}
            · {live} live offer{live === 1 ? '' : 's'}
            {pending ? ` · ${pending} waiting for review` : ''}
          </div>
        </div>
        <span className={`pill-status ${s.is_active ? 'live' : 'blocked'}`}>
          {s.is_active ? 'active' : 'hidden'}
        </span>
      </div>

      {editing ? (
        <form onSubmit={submit} noValidate style={{ marginTop: 10 }}>
          <div className="field">
            <label htmlFor={`s-name-${s.id}`}>Shop name</label>
            <input
              id={`s-name-${s.id}`}
              value={f.name}
              maxLength={120}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor={`s-cat-${s.id}`}>Category</label>
            <select
              id={`s-cat-${s.id}`}
              value={f.category_id ?? ''}
              onChange={(e) => setF({ ...f, category_id: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">No category</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.icon} {cat.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor={`s-phone-${s.id}`}>Phone</label>
              <input
                id={`s-phone-${s.id}`}
                type="tel"
                value={f.phone}
                maxLength={20}
                onChange={(e) => setF({ ...f, phone: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor={`s-wa-${s.id}`}>WhatsApp</label>
              <input
                id={`s-wa-${s.id}`}
                type="tel"
                value={f.whatsapp}
                maxLength={20}
                onChange={(e) => setF({ ...f, whatsapp: e.target.value })}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor={`s-desc-${s.id}`}>Description</label>
            <textarea
              id={`s-desc-${s.id}`}
              value={f.description}
              maxLength={1000}
              onChange={(e) => setF({ ...f, description: e.target.value })}
            />
          </div>
          <label className="meta" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <input
              type="checkbox"
              checked={f.is_active}
              onChange={(e) => setF({ ...f, is_active: e.target.checked })}
            />
            Shop is active (visible to customers when the vendor is approved)
          </label>
          {error && <p className="error-text">{error}</p>}
          <div className="btn-row">
            <button className="btn small" type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save shop'}
            </button>
            <button type="button" className="btn small secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="btn-row">
          <button className="btn small secondary" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button
            className="btn small danger"
            disabled={remove.isPending}
            onClick={() => {
              if (
                window.confirm(
                  `Delete the shop "${s.name}" with its branches and ${s.offers.length} offer(s)? This cannot be undone.`,
                )
              )
                remove.mutate();
            }}
          >
            Delete shop
          </button>
        </div>
      )}
    </div>
  );
}

function PasswordCard({ vendorId }: { vendorId: number }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () => adminApi('/api/admin/vendors/password', { vendor_id: vendorId, password }),
    onSuccess: () => {
      setPassword('');
      setPassword2('');
      toast('New password set. Share it with the owner privately.');
    },
    onError: (e) => setError(friendlyError(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem =
      password.length < 8
        ? 'Password must be at least 8 characters.'
        : password !== password2
          ? 'The two passwords do not match.'
          : null;
    setError(problem ?? '');
    if (!problem) save.mutate();
  };

  return (
    <form className="form-card section" onSubmit={submit} noValidate>
      <h3 style={{ marginTop: 0 }}>🔑 Owner password</h3>
      <p className="meta" style={{ marginTop: 0 }}>
        Passwords are stored encrypted, so nobody (including admins) can see the current one. You can set a
        new password here; the owner's old password stops working straight away.
      </p>
      <div className="field-row">
        <div className="field">
          <label htmlFor="pw-new">New password</label>
          <PasswordInput
            id="pw-new"
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
            placeholder="At least 8 characters"
          />
        </div>
        <div className="field">
          <label htmlFor="pw-confirm">Confirm</label>
          <PasswordInput
            id="pw-confirm"
            autoComplete="new-password"
            value={password2}
            onChange={setPassword2}
            placeholder="Type it again"
          />
        </div>
      </div>
      {error && <p className="error-text">{error}</p>}
      <button className="btn" type="submit" disabled={save.isPending}>
        {save.isPending ? 'Saving…' : 'Set new password'}
      </button>
    </form>
  );
}

function OffersCard({ vendorId }: { vendorId: number }) {
  const shops = useVendorShops(vendorId);
  const [onlyLive, setOnlyLive] = useState(true);
  const all = (shops.data ?? []).flatMap((s) =>
    s.offers.map((o) => ({ o, shop: s.name, phase: offerPhase(o) })),
  );
  const liveCount = all.filter((x) => x.phase === 'live').length;
  const shown = (onlyLive ? all.filter((x) => x.phase === 'live') : all).sort((x, y) =>
    y.o.created_at.localeCompare(x.o.created_at),
  );
  const money = (n: number | null) => (n == null ? '' : `₹${Number(n).toLocaleString('en-IN')}`);

  return (
    <section className="form-card section">
      <h3 style={{ marginTop: 0 }}>🏷️ Offers</h3>
      <div className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={onlyLive}
          className={onlyLive ? 'active' : ''}
          onClick={() => setOnlyLive(true)}
        >
          Live now ({liveCount})
        </button>
        <button
          role="tab"
          aria-selected={!onlyLive}
          className={!onlyLive ? 'active' : ''}
          onClick={() => setOnlyLive(false)}
        >
          All ({all.length})
        </button>
      </div>
      {shops.isPending && <Loading />}
      {shops.error && <ErrorNotice error={shops.error} />}
      {shops.data && shown.length === 0 && (
        <p className="meta">{onlyLive ? 'No live offers right now.' : 'No offers yet.'}</p>
      )}
      {shown.map(({ o, shop, phase }) => (
        <div key={o.id} className="manage-card">
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <div className="grow">
              <h4>{o.title}</h4>
              <div className="meta">
                🏬 {shop}
                {o.discount_label ? ` · ${o.discount_label}` : ''}
                {o.offer_price != null ? ` · ${money(o.offer_price)}` : ''}
                {o.original_price != null && o.offer_price != null ? (
                  <s style={{ marginLeft: 4 }}>{money(o.original_price)}</s>
                ) : null}
              </div>
              <div className="meta">
                {formatDay(o.starts_on)}
                {o.ends_on ? ` to ${formatDay(o.ends_on)}` : ' · no end date'}
              </div>
              {o.status === 'rejected' && o.reject_reason && (
                <div className="meta" style={{ color: 'var(--color-red)' }}>
                  Rejected: {o.reject_reason}
                </div>
              )}
            </div>
            <span className={`pill-status ${phaseClass[phase]}`}>{phaseLabel[phase]}</span>
          </div>
        </div>
      ))}
    </section>
  );
}

function PlanCard({ vendorId, invoices }: { vendorId: number; invoices: number }) {
  const plan = useQuery({
    queryKey: ['admin', 'vendor', vendorId, 'plan'],
    queryFn: async () =>
      must<{ starts_on: string; ends_on: string; plan: { name: string } | { name: string }[] | null }[]>(
        await db()
          .from('subscriptions')
          .select('starts_on, ends_on, plan:plans(name)')
          .eq('vendor_id', vendorId)
          .is('cancelled_at', null)
          .order('ends_on', { ascending: false })
          .limit(1),
      ),
  });
  const sub = plan.data?.[0];
  return (
    <section className="form-card section">
      <h3 style={{ marginTop: 0 }}>💳 Plan & billing</h3>
      {plan.error && <ErrorNotice error={plan.error} />}
      <p className="meta" style={{ margin: 0 }}>
        {sub
          ? `${one(sub.plan)?.name ?? 'Plan'} · ${formatDate(sub.starts_on)} to ${formatDate(sub.ends_on)}`
          : 'No active plan'}{' '}
        · {invoices} invoice{invoices === 1 ? '' : 's'} · <Link to="/admin/billing">Open billing</Link>
      </p>
    </section>
  );
}

function DeleteCard({ vendor: v, invoices }: { vendor: Vendor; invoices: number }) {
  const toast = useToast();
  const navigate = useNavigate();
  const invalidate = useInvalidate();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');

  const remove = useMutation({
    mutationFn: async () => {
      must(await db().rpc('admin_delete_vendor', { p_vendor_id: v.id }));
    },
    onSuccess: () => {
      invalidate(['admin', 'vendors'], DIRECTORY_KEY, ['admin_stats'], ...PUBLIC_KEYS);
      toast(`${v.business_name} deleted`);
      navigate('/admin/vendors?status=all', { replace: true });
    },
    onError: (e) => setError(friendlyError(e)),
  });

  return (
    <section className="form-card section" style={{ borderColor: 'var(--color-red)' }}>
      <h3 style={{ marginTop: 0, color: 'var(--color-red)' }}>Delete vendor</h3>
      {invoices > 0 ? (
        <p className="meta" style={{ margin: 0 }}>
          This vendor has {invoices} invoice{invoices === 1 ? '' : 's'}, which must be kept for your records,
          so it cannot be deleted. Set its status to <b>Blocked</b> above to hide it instead.
        </p>
      ) : (
        <>
          <p className="meta" style={{ marginTop: 0 }}>
            Permanently deletes <b>{v.business_name}</b> with all its shops, branches, offers and team. The
            owner keeps their customer account. This cannot be undone.
          </p>
          <div className="field">
            <label htmlFor="del-confirm">Type the business name to confirm</label>
            <input
              id="del-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
            />
          </div>
          {error && <p className="error-text">{error}</p>}
          <button
            className="btn danger"
            disabled={typed.trim() !== v.business_name.trim() || remove.isPending}
            onClick={() => remove.mutate()}
          >
            {remove.isPending ? 'Deleting…' : 'Delete vendor permanently'}
          </button>
        </>
      )}
    </section>
  );
}

/** Super admins: create a vendor with a new account (with a password) or from an existing account. */
export function VendorCreate() {
  const { roles } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const invalidate = useInvalidate();
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [email, setEmail] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerMobile, setOwnerMobile] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [error, setError] = useState('');

  const create = useMutation({
    mutationFn: async () => {
      if (mode === 'new') {
        const out = await adminApi<{ vendor_id: number }>('/api/admin/vendors', {
          email: email.trim(),
          password,
          full_name: ownerName.trim(),
          phone: ownerMobile.trim(),
          business_name: name.trim(),
          business_phone: phone.trim(),
          whatsapp: whatsapp.trim(),
        });
        return out.vendor_id;
      }
      return must<number>(
        await db().rpc('admin_create_vendor', {
          p_email: email.trim(),
          p_business_name: name.trim(),
          p_phone: phone.trim(),
          p_whatsapp: whatsapp.trim(),
        }),
      );
    },
    onSuccess: (id) => {
      invalidate(['admin', 'vendors'], DIRECTORY_KEY, ['admin_stats'], ...PUBLIC_KEYS);
      toast(
        mode === 'new'
          ? 'Account and vendor created. Share the password privately.'
          : 'Vendor created and approved',
      );
      navigate(`/admin/vendors/${id}`, { replace: true });
    },
    onError: (e) => setError(friendlyError(e)),
  });

  if (!roles.includes('super_admin')) {
    return <p className="notice bad">Only a super admin can add vendors.</p>;
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    const problem =
      (!/^S+@S+.S+$/.test(email.trim()) ? 'Enter the owner’s email address.' : null) ??
      (mode === 'new' && ownerName.trim().length < 2 ? 'Enter the owner’s name.' : null) ??
      (mode === 'new' ? phoneError(ownerMobile, 'Owner mobile') : null) ??
      (mode === 'new' && password.length < 8 ? 'Password must be at least 8 characters.' : null) ??
      (mode === 'new' && password !== password2 ? 'The two passwords do not match.' : null) ??
      (n.length < 2 || n.length > 120 ? 'Business name should be 2 to 120 characters.' : null) ??
      phoneError(phone) ??
      phoneError(whatsapp, 'WhatsApp');
    setError(problem ?? '');
    if (!problem) create.mutate();
  };

  return (
    <>
      <div className="section-head">
        <h2>Add vendor</h2>
        <Link to="/admin/vendors">‹ All vendors</Link>
      </div>
      <form className="form-card" onSubmit={submit} noValidate>
        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'new'}
            className={mode === 'new' ? 'active' : ''}
            onClick={() => setMode('new')}
          >
            New account
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'existing'}
            className={mode === 'existing' ? 'active' : ''}
            onClick={() => setMode('existing')}
          >
            Existing account
          </button>
        </div>
        <p className="meta" style={{ marginTop: 0 }}>
          {mode === 'new'
            ? 'Creates a sign-in for the owner with the password you set (no email confirmation needed). Share the password with them privately.'
            : 'For someone who already has an IWILLFLY account. They keep their current password.'}{' '}
          The vendor starts as <b>approved</b>.
        </p>

        <h3>Owner</h3>
        <div className="field">
          <label htmlFor="c-email">
            {mode === 'new' ? 'Email (their sign-in) *' : "Owner's account email *"}
          </label>
          <input
            id="c-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {mode === 'new' && (
          <>
            <div className="field-row">
              <div className="field">
                <label htmlFor="c-owner">Owner name *</label>
                <input
                  id="c-owner"
                  value={ownerName}
                  maxLength={120}
                  onChange={(e) => setOwnerName(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="c-mobile">Owner mobile</label>
                <input
                  id="c-mobile"
                  type="tel"
                  value={ownerMobile}
                  maxLength={20}
                  onChange={(e) => setOwnerMobile(e.target.value)}
                />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="c-pw">Password *</label>
                <PasswordInput
                  id="c-pw"
                  autoComplete="new-password"
                  value={password}
                  onChange={setPassword}
                  placeholder="At least 8 characters"
                />
              </div>
              <div className="field">
                <label htmlFor="c-pw2">Confirm password *</label>
                <PasswordInput
                  id="c-pw2"
                  autoComplete="new-password"
                  value={password2}
                  onChange={setPassword2}
                  placeholder="Type it again"
                />
              </div>
            </div>
          </>
        )}

        <h3>Business</h3>
        <div className="field">
          <label htmlFor="c-name">Business name *</label>
          <input id="c-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="c-phone">Business phone</label>
            <input
              id="c-phone"
              type="tel"
              value={phone}
              maxLength={20}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={mode === 'new' ? 'Empty = owner mobile' : ''}
            />
          </div>
          <div className="field">
            <label htmlFor="c-wa">WhatsApp</label>
            <input
              id="c-wa"
              type="tel"
              value={whatsapp}
              maxLength={20}
              onChange={(e) => setWhatsapp(e.target.value)}
            />
          </div>
        </div>
        {error && <p className="error-text">{error}</p>}
        <button className="btn block" type="submit" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create vendor'}
        </button>
      </form>
    </>
  );
}
