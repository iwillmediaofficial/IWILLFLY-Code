import { lazy, Suspense, useState, type CSSProperties, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { db, must } from '../../lib/queries';
import { addDays, todayIST } from '../engagement/api';
import type { SeriesDef } from '../engagement/Charts';
import { Empty, ErrorNotice, Loading } from '../ui';
import { formatDate } from '../util';

const DailyBarChart = lazy(() => import('../engagement/Charts').then((m) => ({ default: m.DailyBarChart })));

/** What public.admin_reports returns (see supabase/migrations/20261005050000_reports_hardening.sql). */
interface Reports {
  from: string;
  to: string;
  growth: {
    totals: {
      customers: number;
      vendors: number;
      vendors_approved: number;
      shops: number;
      offers_live: number;
    };
    new: { customers: number; vendors: number; shops: number; offers: number };
    weekly: { week: string; customers: number; vendors: number; shops: number; offers: number }[];
  };
  offers: {
    by_status: { pending: number; approved: number; rejected: number; paused: number; expiring_7d: number };
    totals: { views: number; clicks: number; saves: number; leads: number };
    top: {
      offer_id: number;
      title: string;
      shop_name: string;
      views: number;
      clicks: number;
      saves: number;
      leads: number;
    }[];
    no_views: { offer_id: number; title: string; shop_name: string }[];
    by_category: { category: string; offers: number; views: number; clicks: number; leads: number }[];
  };
  locations: {
    location_id: number;
    name: string;
    kind: string;
    shops: number;
    live_offers: number;
    customers: number;
    views: number;
    plays: number;
  }[];
  claims: {
    totals: {
      plays: number;
      wins: number;
      claimed: number;
      unclaimed: number;
      expired: number;
      flagged: number;
      players: number;
    };
    campaigns: {
      campaign_id: number;
      name: string;
      plays: number;
      wins: number;
      claimed: number;
      unclaimed: number;
      expired: number;
      stock_left: number;
    }[];
    vendors: { vendor_id: number; business_name: string; wins: number; claimed: number; expired: number }[];
  };
}

const RANGES = [
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 365, label: 'Last year' },
];

const SECTIONS = [
  { key: 'growth', label: 'Growth' },
  { key: 'offers', label: 'Offers' },
  { key: 'locations', label: 'Locations' },
  { key: 'claims', label: 'Claims' },
] as const;
type Section = (typeof SECTIONS)[number]['key'];

const GROWTH: SeriesDef[] = [
  { key: 'customers', label: 'Customers', color: '#1760d9' },
  { key: 'vendors', label: 'Vendors', color: 'var(--color-orange)' },
  { key: 'offers', label: 'Offers', color: 'var(--color-green)' },
];

const fmt = (v: number | null | undefined) => Number(v ?? 0).toLocaleString('en-IN');
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '–');

const cell: CSSProperties = { padding: '8px 6px', textAlign: 'right', whiteSpace: 'nowrap' };
const first: CSSProperties = { ...cell, textAlign: 'left', whiteSpace: 'normal', fontWeight: 700 };
const line = '1px solid var(--color-line)';

/** Saves rows as a CSV file the admin can open in Excel or Google Sheets. */
function downloadCsv(name: string, head: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [head, ...rows].map((r) => r.map(esc).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function Table({
  title,
  file,
  head,
  rows,
  empty,
}: {
  title: string;
  file: string;
  head: string[];
  rows: (string | number)[][];
  empty: string;
}) {
  return (
    <section style={{ marginBottom: 18 }}>
      <div className="section-head">
        <h2>{title}</h2>
        {rows.length > 0 && (
          <button className="link-btn" onClick={() => downloadCsv(file, head, rows)}>
            ⤓ CSV
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="meta">{empty}</p>
      ) : (
        <div className="manage-card" style={{ overflowX: 'auto', padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: line, color: 'var(--color-muted)' }}>
                {head.map((h, i) => (
                  <th key={h} style={i === 0 ? { ...cell, textAlign: 'left' } : cell}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderBottom: line }}>
                  {r.map((v, j) => (
                    <td key={j} style={j === 0 ? first : cell}>
                      {typeof v === 'number' ? fmt(v) : v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Tiles({ items }: { items: [string, ReactNode][] }) {
  return (
    <div className="info-grid" style={{ marginBottom: 14 }}>
      {items.map(([label, value]) => (
        <div key={label} className="info-card">
          <strong>{value}</strong>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

export default function AdminReports() {
  const [range, setRange] = useState(30);
  const [section, setSection] = useState<Section>('growth');
  const to = todayIST();
  const from = addDays(to, -(range - 1));
  const q = useQuery({
    queryKey: ['admin-reports', from, to],
    queryFn: async () => must<Reports>(await db().rpc('admin_reports', { p_from: from, p_to: to })),
  });

  return (
    <>
      <div className="section-head">
        <h2>Reports</h2>
        <button className="link-btn" disabled={q.isFetching} onClick={() => q.refetch()}>
          {q.isFetching ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>
      <div className="tabs" role="tablist" aria-label="Report">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={section === s.key}
            className={section === s.key ? 'active' : ''}
            onClick={() => setSection(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="report-range">Dates</label>
        <select id="report-range" value={range} onChange={(e) => setRange(Number(e.target.value))}>
          {RANGES.map((r) => (
            <option key={r.days} value={r.days}>
              {r.label}
            </option>
          ))}
        </select>
        <div className="hint">
          {formatDate(from)} – {formatDate(to)} (India dates)
        </div>
      </div>
      {q.isPending && <Loading />}
      {q.error && <ErrorNotice error={q.error} />}
      {q.data && section === 'growth' && <Growth data={q.data} />}
      {q.data && section === 'offers' && <Offers data={q.data} />}
      {q.data && section === 'locations' && <Locations data={q.data} />}
      {q.data && section === 'claims' && <Claims data={q.data} />}
    </>
  );
}

function Growth({ data }: { data: Reports }) {
  const g = data.growth;
  const anyNew = g.new.customers + g.new.vendors + g.new.shops + g.new.offers > 0;
  return (
    <>
      <Tiles
        items={[
          ['Customers', fmt(g.totals.customers)],
          ['Vendors (approved)', `${fmt(g.totals.vendors)} (${fmt(g.totals.vendors_approved)})`],
          ['Shops', fmt(g.totals.shops)],
          ['Live offers', fmt(g.totals.offers_live)],
        ]}
      />
      <section style={{ marginBottom: 18 }}>
        <div className="section-head">
          <h2>New each week</h2>
        </div>
        <p className="meta" style={{ marginTop: 0 }}>
          +{fmt(g.new.customers)} customers · +{fmt(g.new.vendors)} vendors · +{fmt(g.new.shops)} shops · +
          {fmt(g.new.offers)} offers in these dates
        </p>
        {anyNew ? (
          <div className="manage-card" style={{ padding: '12px 8px 4px' }}>
            <Suspense fallback={<div style={{ height: 240 }} className="meta" />}>
              <DailyBarChart data={g.weekly.map((w) => ({ ...w, day: w.week }))} series={GROWTH} />
            </Suspense>
          </div>
        ) : (
          <p className="meta">Nobody new joined in these dates.</p>
        )}
      </section>
      <Table
        title="Week by week"
        file={`iwillfly-growth-${data.from}-${data.to}`}
        head={['Week starting', 'Customers', 'Vendors', 'Shops', 'Offers']}
        rows={[...g.weekly]
          .reverse()
          .map((w) => [formatDate(w.week), w.customers, w.vendors, w.shops, w.offers])}
        empty="No weeks in these dates."
      />
    </>
  );
}

function Offers({ data }: { data: Reports }) {
  const o = data.offers;
  return (
    <>
      <Tiles
        items={[
          ['Views', fmt(o.totals.views)],
          ['Offer taps', `${fmt(o.totals.clicks)} (${pct(o.totals.clicks, o.totals.views)})`],
          ['Saves', fmt(o.totals.saves)],
          ['Leads (WhatsApp, call, map)', fmt(o.totals.leads)],
        ]}
      />
      <p className="meta" style={{ marginTop: -4 }}>
        Right now: {fmt(o.by_status.approved)} approved, {fmt(o.by_status.pending)} waiting for review,{' '}
        {fmt(o.by_status.rejected)} rejected, {fmt(o.by_status.paused)} paused, {fmt(o.by_status.expiring_7d)}{' '}
        ending in the next 7 days.
      </p>
      <Table
        title="Best offers"
        file={`iwillfly-top-offers-${data.from}-${data.to}`}
        head={['Offer', 'Shop', 'Views', 'Taps', 'Saves', 'Leads']}
        rows={o.top.map((x) => [x.title, x.shop_name, x.views, x.clicks, x.saves, x.leads])}
        empty="No offer views in these dates."
      />
      <Table
        title="By category"
        file={`iwillfly-categories-${data.from}-${data.to}`}
        head={['Category', 'Offers seen', 'Views', 'Taps', 'Leads']}
        rows={o.by_category.map((x) => [x.category, x.offers, x.views, x.clicks, x.leads])}
        empty="No category activity in these dates."
      />
      <Table
        title="Live offers nobody viewed"
        file={`iwillfly-unseen-offers-${data.from}-${data.to}`}
        head={['Offer', 'Shop']}
        rows={o.no_views.map((x) => [x.title, x.shop_name])}
        empty="Every live offer was viewed at least once."
      />
    </>
  );
}

function Locations({ data }: { data: Reports }) {
  if (data.locations.length === 0) {
    return (
      <Empty emoji="📍" title="No activity by place yet">
        Cities show up here once they have shops, customers or views.
      </Empty>
    );
  }
  return (
    <>
      <p className="meta" style={{ marginTop: 0 }}>
        Areas are added up into their city. Shops and customers are current totals; views and scratches are
        for the dates above.
      </p>
      <Table
        title="By city"
        file={`iwillfly-locations-${data.from}-${data.to}`}
        head={['City', 'Shops', 'Live offers', 'Customers', 'Views', 'Scratches']}
        rows={data.locations.map((l) => [l.name, l.shops, l.live_offers, l.customers, l.views, l.plays])}
        empty=""
      />
    </>
  );
}

function Claims({ data }: { data: Reports }) {
  const t = data.claims.totals;
  return (
    <>
      <Tiles
        items={[
          [`Scratches by ${fmt(t.players)} people`, fmt(t.plays)],
          ['Wins', `${fmt(t.wins)} (${pct(t.wins, t.plays)})`],
          ['Claimed', `${fmt(t.claimed)} (${pct(t.claimed, t.wins)})`],
          ['Expired unclaimed', fmt(t.expired)],
        ]}
      />
      <p className="meta" style={{ marginTop: -4 }}>
        {fmt(t.unclaimed)} prizes are still waiting to be claimed. {fmt(t.flagged)} plays are flagged for
        fraud.
      </p>
      <Table
        title="By campaign"
        file={`iwillfly-claims-campaigns-${data.from}-${data.to}`}
        head={['Campaign', 'Scratches', 'Wins', 'Claimed', 'Waiting', 'Expired', 'Stock left']}
        rows={data.claims.campaigns.map((c) => [
          c.name,
          c.plays,
          c.wins,
          c.claimed,
          c.unclaimed,
          c.expired,
          c.stock_left,
        ])}
        empty="No scratches in these dates."
      />
      <Table
        title="By sponsoring vendor"
        file={`iwillfly-claims-vendors-${data.from}-${data.to}`}
        head={['Vendor', 'Prizes won', 'Claimed', 'Expired', 'Claim rate']}
        rows={data.claims.vendors.map((v) => [
          v.business_name,
          v.wins,
          v.claimed,
          v.expired,
          pct(v.claimed, v.wins),
        ])}
        empty="No vendor-sponsored prizes won in these dates."
      />
    </>
  );
}
