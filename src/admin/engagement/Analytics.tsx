import { lazy, Suspense, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { AdminAnalytics as Data, StatTotals } from '../../lib/types';
import { Empty, ErrorNotice, Loading } from '../ui';
import { formatDate } from '../util';
import { addDays, todayIST, useAdminAnalytics } from './api';
import type { SeriesDef } from './Charts';

const DailyLineChart = lazy(() => import('./Charts').then((m) => ({ default: m.DailyLineChart })));
const DailyBarChart = lazy(() => import('./Charts').then((m) => ({ default: m.DailyBarChart })));

const BLUE = '#1760d9';
const YELLOW = '#ffdc16';
const GREEN = 'var(--color-green)';

const RANGES = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
];

const TILES: { key: keyof StatTotals; label: string }[] = [
  { key: 'views', label: 'Views' },
  { key: 'clicks', label: 'Offer taps' },
  { key: 'saves', label: 'Saves' },
  { key: 'whatsapp', label: 'WhatsApp leads' },
  { key: 'calls', label: 'Calls' },
  { key: 'directions', label: 'Directions' },
];

const TRAFFIC: SeriesDef[] = [
  { key: 'views', label: 'Views', color: BLUE },
  { key: 'clicks', label: 'Offer taps', color: YELLOW },
  { key: 'whatsapp', label: 'WhatsApp', color: GREEN },
];

const SCRATCH: SeriesDef[] = [
  { key: 'plays', label: 'Plays', color: BLUE },
  { key: 'wins', label: 'Wins', color: YELLOW },
  { key: 'claims', label: 'Claims', color: GREEN },
];

const n = (v: unknown) => Number(v ?? 0) || 0;
const fmt = (v: number) => v.toLocaleString('en-IN');
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '–');

/** Every day from `from` to `to`, so charts show zero days instead of skipping them. */
function days(from: string, to: string) {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 100; d = addDays(d, 1)) out.push(d);
  return out;
}

function shortDay(day: string) {
  return formatDate(`${day}T00:00:00+05:30`).replace(/ \d{4}$/, '');
}

const cell: CSSProperties = { padding: '8px 6px', textAlign: 'right', whiteSpace: 'nowrap' };
const line = '1px solid var(--color-line)';

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
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
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function ChartCard({ children }: { children: ReactNode }) {
  return (
    <div className="manage-card" style={{ padding: '12px 8px 4px', marginBottom: 10 }}>
      <Suspense fallback={<div style={{ height: 220 }} className="meta" />}>{children}</Suspense>
    </div>
  );
}

export default function AdminAnalytics() {
  const [range, setRange] = useState(7);
  const to = todayIST();
  const from = addDays(to, -(range - 1));
  const q = useAdminAnalytics(from, to);

  return (
    <>
      <div className="section-head">
        <h2>Analytics</h2>
        <button className="link-btn" disabled={q.isFetching} onClick={() => q.refetch()}>
          {q.isFetching ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>
      <div className="tabs" role="tablist">
        {RANGES.map((r) => (
          <button
            key={r.days}
            role="tab"
            aria-selected={range === r.days}
            className={range === r.days ? 'active' : ''}
            onClick={() => setRange(r.days)}
          >
            {r.label}
          </button>
        ))}
      </div>
      <p className="meta" style={{ marginTop: 0 }}>
        {formatDate(from)} – {formatDate(to)} (India dates)
      </p>
      {q.isPending && <Loading />}
      {q.error && <ErrorNotice error={q.error} />}
      {q.data && <Report data={q.data} />}
    </>
  );
}

function Report({ data }: { data: Data }) {
  const allDays = useMemo(() => days(data.from, data.to), [data.from, data.to]);

  const traffic = useMemo(() => {
    const by = new Map(data.daily.map((d) => [d.day, d]));
    return allDays.map((day) => {
      const d = by.get(day);
      return { day, views: n(d?.views), clicks: n(d?.clicks), whatsapp: n(d?.whatsapp) };
    });
  }, [allDays, data.daily]);

  const scratch = useMemo(() => {
    const by = new Map(data.scratch_daily.map((d) => [d.day, d]));
    return allDays.map((day) => {
      const d = by.get(day);
      return { day, plays: n(d?.plays), wins: n(d?.wins), claims: n(d?.claims) };
    });
  }, [allDays, data.scratch_daily]);

  const users = useMemo(() => {
    const by = new Map(data.new_users.map((d) => [d.day, n(d.users)]));
    return allDays.map((day) => ({ day, users: by.get(day) ?? 0 }));
  }, [allDays, data.new_users]);

  const totals = data.totals;
  const hasTraffic = TILES.some((t) => n(totals[t.key]) > 0);
  const scratchTotal = scratch.reduce(
    (s, d) => ({ plays: s.plays + d.plays, wins: s.wins + d.wins, claims: s.claims + d.claims }),
    { plays: 0, wins: 0, claims: 0 },
  );
  const usersTotal = users.reduce((s, d) => s + d.users, 0);

  if (!hasTraffic && scratchTotal.plays === 0 && usersTotal === 0) {
    return (
      <Empty emoji="📊" title="No activity in these dates">
        Views, taps, leads, Scratch &amp; Win plays and sign-ups show up here as people use the app.
      </Empty>
    );
  }

  return (
    <>
      <div className="info-grid" style={{ marginBottom: 14 }}>
        {TILES.map((t) => (
          <div key={t.key} className="info-card">
            <strong>{fmt(n(totals[t.key]))}</strong>
            <span>{t.label}</span>
          </div>
        ))}
      </div>

      <section style={{ marginBottom: 18 }}>
        <div className="section-head">
          <h2>Daily activity</h2>
        </div>
        {hasTraffic ? (
          <ChartCard>
            <DailyLineChart data={traffic} series={TRAFFIC} />
          </ChartCard>
        ) : (
          <p className="meta">No views or taps in these dates.</p>
        )}
      </section>

      {hasTraffic && (
        <section style={{ marginBottom: 18 }}>
          <div className="section-head">
            <h2>Top offers</h2>
          </div>
          {data.top_offers.length === 0 ? (
            <p className="meta">No offer activity yet.</p>
          ) : (
            <Table head={['Offer', 'Views', 'Taps', 'WhatsApp']}>
              {data.top_offers.map((o) => (
                <tr key={o.offer_id} style={{ borderBottom: line }}>
                  <td style={{ ...cell, textAlign: 'left', whiteSpace: 'normal', fontWeight: 700 }}>
                    {o.title}
                    <div className="meta" style={{ fontWeight: 400 }}>
                      {o.shop_name}
                    </div>
                  </td>
                  <td style={cell}>{fmt(n(o.views))}</td>
                  <td style={cell}>{fmt(n(o.clicks))}</td>
                  <td style={cell}>{fmt(n(o.whatsapp))}</td>
                </tr>
              ))}
            </Table>
          )}
        </section>
      )}

      {hasTraffic && (
        <section style={{ marginBottom: 18 }}>
          <div className="section-head">
            <h2>Top shops</h2>
          </div>
          {data.top_shops.length === 0 ? (
            <p className="meta">No shop activity yet.</p>
          ) : (
            <Table head={['Shop', 'Views', 'WhatsApp', 'Calls', 'Saves']}>
              {data.top_shops.map((s) => (
                <tr key={s.shop_id} style={{ borderBottom: line }}>
                  <td style={{ ...cell, textAlign: 'left', whiteSpace: 'normal', fontWeight: 700 }}>
                    {s.name}
                  </td>
                  <td style={cell}>{fmt(n(s.views))}</td>
                  <td style={cell}>{fmt(n(s.whatsapp))}</td>
                  <td style={cell}>{fmt(n(s.calls))}</td>
                  <td style={cell}>{fmt(n(s.saves))}</td>
                </tr>
              ))}
            </Table>
          )}
        </section>
      )}

      <section style={{ marginBottom: 18 }}>
        <div className="section-head">
          <h2>Scratch &amp; Win</h2>
          <span className="meta">
            Win rate {pct(scratchTotal.wins, scratchTotal.plays)} · claimed{' '}
            {pct(scratchTotal.claims, scratchTotal.wins)}
          </span>
        </div>
        {scratchTotal.plays === 0 ? (
          <p className="meta">No scratches played in these dates.</p>
        ) : (
          <>
            <ChartCard>
              <DailyBarChart data={scratch} series={SCRATCH} />
            </ChartCard>
            <Table head={['Day', 'Plays', 'Wins', 'Claims', 'Win %', 'Claim %']}>
              {scratch
                .filter((d) => d.plays > 0)
                .reverse()
                .map((d) => (
                  <tr key={d.day} style={{ borderBottom: line }}>
                    <td style={{ ...cell, textAlign: 'left' }}>{shortDay(d.day)}</td>
                    <td style={cell}>{fmt(d.plays)}</td>
                    <td style={cell}>{fmt(d.wins)}</td>
                    <td style={cell}>{fmt(d.claims)}</td>
                    <td style={cell}>{pct(d.wins, d.plays)}</td>
                    <td style={cell}>{pct(d.claims, d.wins)}</td>
                  </tr>
                ))}
              <tr style={{ fontWeight: 800 }}>
                <td style={{ ...cell, textAlign: 'left' }}>Total</td>
                <td style={cell}>{fmt(scratchTotal.plays)}</td>
                <td style={cell}>{fmt(scratchTotal.wins)}</td>
                <td style={cell}>{fmt(scratchTotal.claims)}</td>
                <td style={cell}>{pct(scratchTotal.wins, scratchTotal.plays)}</td>
                <td style={cell}>{pct(scratchTotal.claims, scratchTotal.wins)}</td>
              </tr>
            </Table>
          </>
        )}
      </section>

      <section>
        <div className="section-head">
          <h2>New users</h2>
          <span className="meta">{fmt(usersTotal)} in total</span>
        </div>
        {usersTotal === 0 ? (
          <p className="meta">Nobody signed up in these dates.</p>
        ) : (
          <ChartCard>
            <DailyBarChart data={users} series={[{ key: 'users', label: 'New users', color: BLUE }]} />
          </ChartCard>
        )}
      </section>
    </>
  );
}
