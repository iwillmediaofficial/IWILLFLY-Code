import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useToast } from '../components/Toast';
import { db, must } from '../lib/queries';
import type { Vendor, VendorStatus } from '../lib/types';
import { Empty, ErrorNotice, Loading } from './ui';
import { PUBLIC_KEYS, formatDate, friendlyError, one, useInvalidate, waLink } from './util';
import { DIRECTORY_KEY, useVendorDirectory, type VendorOwnerRow } from './vendorApi';

type Tab = VendorStatus | 'all';
const TABS: { key: Tab; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'all', label: 'All' },
];

type CategoryRef = { name: string; icon: string | null };
type VendorRow = Vendor & {
  shops: { id: number; name: string; category: CategoryRef | CategoryRef[] | null }[];
};

export function Vendors() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.key === params.get('status'))?.key ?? 'pending') as Tab;
  const [search, setSearch] = useState('');
  const { roles } = useAuth();
  const directory = useVendorDirectory();

  const counts = useQuery({
    queryKey: ['admin', 'vendors', 'counts'],
    queryFn: async () => {
      const rows = must<{ status: VendorStatus }[]>(await db().from('vendors').select('status'));
      const c: Record<Tab, number> = { pending: 0, approved: 0, blocked: 0, all: rows.length };
      for (const r of rows) c[r.status] += 1;
      return c;
    },
  });

  const vendors = useQuery({
    queryKey: ['admin', 'vendors', tab],
    queryFn: async () => {
      let q = db()
        .from('vendors')
        .select('*, shops(id, name, category:categories(name, icon))')
        .order('created_at', { ascending: tab === 'pending' });
      if (tab !== 'all') q = q.eq('status', tab);
      return must<VendorRow[]>(await q);
    },
  });

  const q = search.trim().toLowerCase();
  const shown = vendors.data?.filter((v) => {
    if (!q) return true;
    const o = directory.data?.get(v.id);
    return [v.business_name, v.contact_phone, v.whatsapp, o?.owner_email, o?.owner_name, o?.owner_phone].some(
      (x) => x?.toLowerCase().includes(q),
    );
  });

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          type="search"
          className="grow"
          placeholder="Search business, owner email, name or phone"
          aria-label="Search vendors"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ border: '1px solid var(--color-line)', borderRadius: 12, padding: 10, minWidth: 0 }}
        />
        {roles.includes('super_admin') && (
          <Link
            className="btn small"
            to="/admin/vendors/new"
            style={{ whiteSpace: 'nowrap', alignSelf: 'center' }}
          >
            ＋ Add vendor
          </Link>
        )}
      </div>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? 'active' : ''}
            onClick={() => setParams({ status: t.key }, { replace: true })}
          >
            {t.label}
            {counts.data ? ` (${counts.data[t.key]})` : ''}
          </button>
        ))}
      </div>
      {vendors.isPending && <Loading />}
      {vendors.error && <ErrorNotice error={vendors.error} />}
      {shown?.length === 0 && q && <Empty emoji="🔍" title="No vendors match your search" />}
      {vendors.data?.length === 0 && !q && (
        <Empty emoji="🏪" title={tab === 'pending' ? 'No vendors waiting' : 'No vendors here'}>
          {tab === 'pending' ? 'New applications will show up here.' : undefined}
        </Empty>
      )}
      {shown?.map((v) => (
        <VendorCard key={v.id} vendor={v} owner={directory.data?.get(v.id)} />
      ))}
    </>
  );
}

function VendorCard({ vendor: v, owner }: { vendor: VendorRow; owner?: VendorOwnerRow }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [editingNote, setEditingNote] = useState(false);
  const [note, setNote] = useState(v.admin_note ?? '');

  const update = useMutation({
    mutationFn: async (patch: Partial<Vendor>) => {
      must(await db().from('vendors').update(patch).eq('id', v.id));
    },
    onSuccess: () =>
      invalidate(
        ['admin', 'vendors'],
        ['admin', 'vendor', v.id],
        DIRECTORY_KEY,
        ['admin_stats'],
        ...PUBLIC_KEYS,
      ),
    onError: (e) => toast(friendlyError(e)),
  });

  const run = (patch: Partial<Vendor>, done: string) =>
    update.mutate(patch, { onSuccess: () => toast(done) });

  const block = () => {
    const reason = window.prompt(
      `Block ${v.business_name}? Their shops and offers will be hidden from customers.\n\nNote (shown to admins):`,
      v.admin_note ?? '',
    );
    if (reason === null) return;
    run({ status: 'blocked', admin_note: reason.trim().slice(0, 500) || null }, 'Vendor blocked');
  };

  return (
    <div className="manage-card">
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div className="grow">
          <h4>{v.business_name}</h4>
          <div className="meta">Applied {formatDate(v.created_at)}</div>
          {owner && (
            <div className="meta">
              👤 {owner.owner_name ? `${owner.owner_name} · ` : ''}
              {owner.owner_email}
              {owner.owner_phone ? ` · ${owner.owner_phone}` : ''}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <span className={`pill-status ${v.status}`}>{v.status}</span>
          {v.is_verified && <span className="pill-status live">✓ Verified</span>}
        </div>
      </div>

      <div className="meta" style={{ marginTop: 6, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {v.contact_phone && (
          <a href={`tel:${v.contact_phone}`} style={{ color: 'var(--color-blue)', fontWeight: 700 }}>
            📞 {v.contact_phone}
          </a>
        )}
        {v.whatsapp && (
          <a
            href={waLink(v.whatsapp)}
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--color-green)', fontWeight: 700 }}
          >
            💬 WhatsApp {v.whatsapp}
          </a>
        )}
        {!v.contact_phone && !v.whatsapp && <span>No phone given</span>}
      </div>

      <div style={{ marginTop: 8, fontSize: 13 }}>
        {v.shops.length === 0 ? (
          <span className="meta">No shops yet</span>
        ) : (
          v.shops.map((s) => {
            const c = one(s.category);
            return (
              <div key={s.id}>
                🏬 <b>{s.name}</b>{' '}
                <span className="meta">{c ? `· ${c.icon ?? ''} ${c.name}` : '· No category'}</span>
              </div>
            );
          })
        )}
      </div>

      {editingNote ? (
        <div className="field" style={{ marginTop: 10 }}>
          <label htmlFor={`note-${v.id}`}>Admin note</label>
          <textarea
            id={`note-${v.id}`}
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="btn-row">
            <button
              className="btn small"
              disabled={update.isPending}
              onClick={() =>
                update.mutate(
                  { admin_note: note.trim() || null },
                  {
                    onSuccess: () => {
                      setEditingNote(false);
                      toast('Note saved');
                    },
                  },
                )
              }
            >
              Save note
            </button>
            <button
              className="btn small secondary"
              onClick={() => {
                setNote(v.admin_note ?? '');
                setEditingNote(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        v.admin_note && (
          <div className="notice warn" style={{ marginTop: 10, marginBottom: 0 }}>
            <b>Note:</b> {v.admin_note}
          </div>
        )
      )}

      <div className="btn-row">
        {v.status !== 'approved' && v.status !== 'blocked' && (
          <button
            className="btn small"
            disabled={update.isPending}
            onClick={() => run({ status: 'approved' }, 'Vendor approved')}
          >
            Approve
          </button>
        )}
        {v.status === 'blocked' ? (
          <button
            className="btn small"
            disabled={update.isPending}
            onClick={() => {
              if (window.confirm(`Unblock ${v.business_name}? Their shops go live again.`))
                run({ status: 'approved' }, 'Vendor unblocked');
            }}
          >
            Unblock
          </button>
        ) : (
          <button className="btn small danger" disabled={update.isPending} onClick={block}>
            Block
          </button>
        )}
        <button
          className="btn small secondary"
          disabled={update.isPending}
          onClick={() =>
            run({ is_verified: !v.is_verified }, v.is_verified ? 'Verified badge removed' : 'Vendor verified')
          }
        >
          {v.is_verified ? 'Unverify' : 'Verify'}
        </button>
        {!editingNote && (
          <button className="btn small secondary" onClick={() => setEditingNote(true)}>
            {v.admin_note ? 'Edit note' : 'Add note'}
          </button>
        )}
        <Link className="btn small secondary" to={`/admin/vendors/${v.id}`}>
          Details & edit
        </Link>
      </div>
    </div>
  );
}
