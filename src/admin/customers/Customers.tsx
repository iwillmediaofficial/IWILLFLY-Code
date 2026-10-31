import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { MessageCircle, Phone, Search, UserRound } from 'lucide-react';
import { Icon } from '../../components/Icon';
import { pointsText, rupees } from '../../lib/points';
import { db, must } from '../../lib/queries';
import { Empty, ErrorNotice, Loading } from '../ui';
import { formatDate, useDesktop, waLink } from '../util';

/** Admin > Customers: every customer account, searchable, with one customer's details beside it. */

type Kind = 'all' | 'customers' | 'staff';
const KINDS: { key: Kind; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'customers', label: 'Customers only' },
  { key: 'staff', label: 'Also vendor or staff' },
];
const PAGE = 50;

type CustomerRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  area: string | null;
  district: string | null;
  date_of_birth: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  provider: string;
  points: number;
  bills: number;
  bills_pending: number;
  wins: number;
  is_staff: boolean;
  total: number;
};

type BillStatus = 'pending' | 'approved' | 'rejected';
type CustomerDetail = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  date_of_birth: string | null;
  area: string | null;
  district: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  provider: string;
  roles: string[];
  vendor: { id: number; name: string } | null;
  points: { balance: number; earned: number; cashed_out: number; cashed_out_amount: number };
  bill_counts: { all: number; pending: number; approved: number; rejected: number; approved_amount: number };
  bills: {
    id: number;
    status: BillStatus;
    bill_number: string;
    bill_date: string;
    amount: number;
    points: number | null;
    created_at: string;
    shop_name: string;
  }[];
  scratch: { plays: number; wins: number; claimed: number };
  wins: { id: number; played_at: string; claim_status: string; prize_name: string | null }[];
  cashouts: {
    id: number;
    points: number;
    amount: number;
    status: 'requested' | 'paid' | 'rejected';
    requested_at: string;
    decided_at: string | null;
  }[];
  saved_offers: number;
  saved_shops: number;
};

export default function Customers() {
  return (
    <Routes>
      <Route index element={<CustomerList />} />
      <Route path=":id" element={<CustomerOpen />} />
    </Routes>
  );
}

/** On desktop an open customer shows in a panel beside the list; on phones it gets the whole page. */
function CustomerOpen() {
  const desktop = useDesktop();
  const { id } = useParams();
  if (!desktop) return <CustomerView />;
  return (
    <div className="bill-split">
      <div style={{ minWidth: 0 }}>
        <CustomerList selected={id} />
      </div>
      <aside className="bill-panel">
        <CustomerView />
      </aside>
    </div>
  );
}

function useDebounced(value: string, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function CustomerList({ selected }: { selected?: string }) {
  const [params, setParams] = useSearchParams();
  const desktop = useDesktop();
  const kind = (KINDS.find((k) => k.key === params.get('kind'))?.key ?? 'all') as Kind;
  const page = Math.max(0, Number(params.get('page')) || 0);
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebounced(search.trim());

  // keep the search, filter and page in the address so the back link returns to the same list
  const setQuery = (next: { q?: string; kind?: Kind; page?: number }) => {
    const p = new URLSearchParams(params);
    const v = { q, kind, page, ...next };
    if (v.q) p.set('q', v.q);
    else p.delete('q');
    if (v.kind !== 'all') p.set('kind', v.kind);
    else p.delete('kind');
    if (v.page) p.set('page', String(v.page));
    else p.delete('page');
    setParams(p, { replace: true });
  };
  useEffect(() => {
    if (q !== (params.get('q') ?? '')) setQuery({ q, page: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const list = useQuery({
    queryKey: ['admin_customers', q, kind, page],
    queryFn: async () =>
      must<CustomerRow[]>(
        await db().rpc('admin_customers', {
          p_q: q || null,
          p_kind: kind,
          p_limit: PAGE,
          p_offset: page * PAGE,
        }),
      ),
    placeholderData: keepPreviousData,
  });
  const rows = list.data ?? [];
  const total = rows[0]?.total ?? 0;
  const keep = params.toString() ? `?${params.toString()}` : '';

  return (
    <>
      <div className="section-head">
        <h2>Customers{list.data && !q ? ` (${total})` : ''}</h2>
      </div>
      <input
        type="search"
        placeholder="Search name, email or mobile"
        aria-label="Search customers"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          width: '100%',
          border: '1px solid var(--color-line)',
          borderRadius: 12,
          padding: 10,
          marginBottom: 10,
          minWidth: 0,
        }}
      />
      <div className="filter-bar" role="tablist" style={{ marginTop: 0 }}>
        {KINDS.map((k) => (
          <button
            key={k.key}
            role="tab"
            aria-selected={kind === k.key}
            className={`chip${kind === k.key ? ' active' : ''}`}
            onClick={() => setQuery({ kind: k.key, page: 0 })}
          >
            {k.label}
          </button>
        ))}
      </div>
      {list.isPending && <Loading />}
      {list.error && <ErrorNotice error={list.error} />}
      {list.data?.length === 0 &&
        (q ? (
          <Empty icon={Search} title="No customers match your search" />
        ) : (
          <Empty icon={UserRound} title="No customers here" />
        ))}
      {desktop && rows.length > 0 && <CustomerTable rows={rows} selected={selected} keep={keep} />}
      {!desktop && (
        <div className="list">
          {rows.map((c) => (
            <Link key={c.id} className="shop-card" to={`/admin/customers/${c.id}${keep}`}>
              <div className="shop-thumb">
                <Icon icon={UserRound} />
              </div>
              <div style={{ minWidth: 0 }}>
                <h4 style={{ overflowWrap: 'anywhere' }}>{c.full_name || 'No name yet'}</h4>
                <div className="meta" style={{ overflowWrap: 'anywhere' }}>
                  {c.email}
                </div>
                <div className="meta">{[c.phone, areaText(c)].filter(Boolean).join(' · ')}</div>
                <div className="meta">
                  Joined {formatDate(c.created_at)} · {pointsText(c.points)} · {c.bills}{' '}
                  {c.bills === 1 ? 'bill' : 'bills'}
                </div>
                <Pills row={c} />
              </div>
              <div className="chev">›</div>
            </Link>
          ))}
        </div>
      )}
      {total > PAGE && (
        <div className="btn-row" style={{ alignItems: 'center', marginTop: 12 }}>
          <button
            className="btn small secondary"
            disabled={page === 0}
            onClick={() => setQuery({ page: page - 1 })}
          >
            ‹ Newer
          </button>
          <span className="meta">
            {page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {total}
          </span>
          <button
            className="btn small secondary"
            disabled={(page + 1) * PAGE >= total}
            onClick={() => setQuery({ page: page + 1 })}
          >
            Older ›
          </button>
        </div>
      )}
    </>
  );
}

function Pills({ row }: { row: CustomerRow }) {
  if (!row.is_staff && !row.bills_pending) return null;
  return (
    <div className="bill-pills" style={{ marginTop: 4 }}>
      {row.is_staff && <span className="pill-status featured">Vendor / staff</span>}
      {row.bills_pending > 0 && (
        <span className="pill-status pending">{row.bills_pending} bill to check</span>
      )}
    </div>
  );
}

/** "Edappally, Ernakulam" */
function areaText(c: { area: string | null; district: string | null }) {
  return [c.area, c.district].filter(Boolean).join(', ');
}

/** Desktop version of the list: one row per customer, in columns. */
function CustomerTable({ rows, selected, keep }: { rows: CustomerRow[]; selected?: string; keep: string }) {
  return (
    <div className="bill-table" role="table" aria-label="Customers">
      <div className="bill-row cust-row bill-row-head" role="row">
        <span role="columnheader" />
        <span role="columnheader">Customer</span>
        <span role="columnheader" className="cust-col-hide">
          Mobile
        </span>
        <span role="columnheader" className="cust-col-hide">
          Area
        </span>
        <span role="columnheader">Joined</span>
        <span role="columnheader">Points</span>
        <span role="columnheader">Bills</span>
      </div>
      {rows.map((c) => (
        <Link
          key={c.id}
          role="row"
          className={`bill-row cust-row${c.id === selected ? ' selected' : ''}`}
          to={`/admin/customers/${c.id}${keep}`}
          aria-current={c.id === selected ? 'true' : undefined}
        >
          <span role="cell" className="bill-thumb" aria-hidden="true">
            <Icon icon={UserRound} />
          </span>
          <span role="cell">
            <b>{c.full_name || 'No name yet'}</b>
            <div className="meta">{c.email}</div>
            <Pills row={c} />
          </span>
          <span role="cell" className="cust-col-hide">
            {c.phone || <span className="meta">—</span>}
          </span>
          <span role="cell" className="cust-col-hide">
            {areaText(c) || <span className="meta">—</span>}
          </span>
          <span role="cell">{formatDate(c.created_at)}</span>
          <span role="cell" className="bill-points">
            {c.points.toLocaleString('en-IN')}
          </span>
          <span role="cell">
            {c.bills}
            {c.wins > 0 && <div className="meta">{c.wins} won</div>}
          </span>
        </Link>
      ))}
    </div>
  );
}

// Detail -------------------------------------------------------------------------------------------

const BILL_TEXT: Record<BillStatus, string> = {
  pending: 'To check',
  approved: 'Approved',
  rejected: 'Rejected',
};
const CASHOUT_TEXT = { requested: 'Waiting', paid: 'Paid', rejected: 'Rejected' } as const;
const CASHOUT_PILL = { requested: 'pending', paid: 'approved', rejected: 'rejected' } as const;
const CLAIM_TEXT: Record<string, string> = {
  unclaimed: 'Not claimed',
  claimed: 'Claimed',
  expired: 'Expired',
};
const ROLE_TEXT: Record<string, string> = {
  customer: 'Customer',
  vendor: 'Vendor',
  admin: 'Admin',
  super_admin: 'Super admin',
  support: 'Support',
  campaign_manager: 'Campaign manager',
};

function age(dob: string) {
  const d = new Date(`${dob}T00:00:00`);
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate()))
    a -= 1;
  return a;
}

function CustomerView() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const keep = params.toString() ? `?${params.toString()}` : '';
  const valid = !!id && /^[0-9a-f-]{36}$/i.test(id);
  const detail = useQuery({
    queryKey: ['admin_customer', id],
    queryFn: async () => must<CustomerDetail | null>(await db().rpc('admin_customer', { p_id: id })),
    enabled: valid,
  });
  const c = detail.data;
  return (
    <>
      <div className="section-head">
        <h2 style={{ overflowWrap: 'anywhere' }}>{c ? c.full_name || 'No name yet' : 'Customer'}</h2>
        <Link to={`/admin/customers${keep}`} style={{ whiteSpace: 'nowrap' }}>
          ‹ All customers
        </Link>
      </div>
      {!valid && <ErrorNotice error={new Error('No such customer.')} />}
      {detail.isPending && valid && <Loading />}
      {detail.error && <ErrorNotice error={detail.error} />}
      {detail.data === null && <ErrorNotice error={new Error('No such customer.')} />}
      {c && <CustomerFacts c={c} />}
    </>
  );
}

function CustomerFacts({ c }: { c: CustomerDetail }) {
  const roles = c.roles.filter((r) => r !== 'customer');
  return (
    <>
      <section className="form-card" style={{ marginBottom: 12 }}>
        <dl className="bill-facts">
          <dt>Email</dt>
          <dd style={{ overflowWrap: 'anywhere' }}>
            <a href={`mailto:${c.email}`}>{c.email}</a>
            <div className="meta">
              Signs in with {c.provider === 'google' ? 'Google' : 'email and password'}
            </div>
          </dd>
          <dt>Mobile</dt>
          <dd>
            {c.phone ? (
              <>
                {c.phone}
                <div className="btn-row" style={{ marginTop: 6 }}>
                  <a className="btn small secondary" href={`tel:${c.phone}`}>
                    <Icon icon={Phone} /> Call
                  </a>
                  <a className="btn small secondary" href={waLink(c.phone)} target="_blank" rel="noreferrer">
                    <Icon icon={MessageCircle} /> WhatsApp
                  </a>
                </div>
              </>
            ) : (
              <span className="meta">Not given</span>
            )}
          </dd>
          <dt>Area</dt>
          <dd>{areaText(c) || <span className="meta">Not chosen</span>}</dd>
          <dt>Date of birth</dt>
          <dd>
            {c.date_of_birth ? (
              <>
                {formatDate(c.date_of_birth)} <span className="meta">({age(c.date_of_birth)} years)</span>
              </>
            ) : (
              <span className="meta">Not given</span>
            )}
          </dd>
          <dt>Joined</dt>
          <dd>{formatDate(c.created_at)}</dd>
          <dt>Last sign-in</dt>
          <dd>{c.last_sign_in_at ? formatDate(c.last_sign_in_at) : <span className="meta">Never</span>}</dd>
          <dt>Saved</dt>
          <dd>
            {c.saved_offers} {c.saved_offers === 1 ? 'offer' : 'offers'} · {c.saved_shops}{' '}
            {c.saved_shops === 1 ? 'shop' : 'shops'}
          </dd>
          {(roles.length > 0 || c.vendor) && (
            <>
              <dt>Also</dt>
              <dd>
                {roles.map((r) => ROLE_TEXT[r] ?? r).join(', ')}
                {c.vendor && (
                  <div>
                    Owner of <Link to={`/admin/vendors/${c.vendor.id}`}>{c.vendor.name}</Link>
                  </div>
                )}
              </dd>
            </>
          )}
        </dl>
      </section>

      <div className="info-grid three cust-stats">
        <div className="info-card">
          <strong>{c.points.balance.toLocaleString('en-IN')}</strong>
          <span>Points now</span>
        </div>
        <div className="info-card">
          <strong>{c.points.earned.toLocaleString('en-IN')}</strong>
          <span>Points earned</span>
        </div>
        <div className="info-card">
          <strong>{rupees(c.points.cashed_out_amount)}</strong>
          <span>Cashed out</span>
        </div>
        <div className="info-card">
          <strong>{c.bill_counts.all}</strong>
          <span>Bills added</span>
        </div>
        <div className="info-card">
          <strong>{c.scratch.plays}</strong>
          <span>Scratch plays</span>
        </div>
        <div className="info-card">
          <strong>{c.scratch.wins}</strong>
          <span>Prizes won</span>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Bills</h2>
          {c.bill_counts.approved > 0 && (
            <span className="meta">{rupees(c.bill_counts.approved_amount)} approved</span>
          )}
        </div>
        {c.bills.length === 0 ? (
          <p className="meta">No bills yet.</p>
        ) : (
          <div className="cust-list">
            {c.bills.map((b) => (
              <Link
                key={b.id}
                className="manage-card cust-line"
                to={`/admin/points/bills/${b.id}?from=${b.status}`}
              >
                <div style={{ minWidth: 0 }}>
                  <b>
                    {b.shop_name} · {rupees(b.amount)}
                  </b>
                  <div className="meta">
                    #{b.id} · bill {b.bill_number} of {formatDate(b.bill_date)}
                    {b.status === 'approved' && b.points != null && ` · +${pointsText(b.points)}`}
                  </div>
                </div>
                <span className={`pill-status ${b.status}`}>{BILL_TEXT[b.status]}</span>
              </Link>
            ))}
            {c.bill_counts.all > c.bills.length && (
              <p className="meta">
                Showing the latest {c.bills.length} of {c.bill_counts.all} bills.
              </p>
            )}
          </div>
        )}
      </section>

      {c.wins.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Prizes won</h2>
          </div>
          <div className="cust-list">
            {c.wins.map((w) => (
              <div key={w.id} className="manage-card cust-line">
                <div style={{ minWidth: 0 }}>
                  <b>{w.prize_name ?? 'Prize'}</b>
                  <div className="meta">{formatDate(w.played_at)}</div>
                </div>
                <span className={`pill-status ${w.claim_status === 'claimed' ? 'approved' : 'pending'}`}>
                  {CLAIM_TEXT[w.claim_status] ?? w.claim_status}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {c.cashouts.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Cash-outs</h2>
          </div>
          <div className="cust-list">
            {c.cashouts.map((r) => (
              <div key={r.id} className="manage-card cust-line">
                <div style={{ minWidth: 0 }}>
                  <b>
                    {rupees(r.amount)} · {pointsText(r.points)}
                  </b>
                  <div className="meta">Asked {formatDate(r.requested_at)}</div>
                </div>
                <span className={`pill-status ${CASHOUT_PILL[r.status]}`}>{CASHOUT_TEXT[r.status]}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
