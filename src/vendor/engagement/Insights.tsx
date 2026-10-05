import { lazy, Suspense } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { VendorAnalytics } from '../../lib/types';
import { formatDate } from '../format';
import { ErrorNote, Loading, PageHead } from '../ui';
import { addDays, useVendorAnalytics } from './api';
import { num, shortDay, tapRate } from './format';
import type { ChartDay } from './InsightsChart';

// recharts is big: load the chart only when this page needs it.
const InsightsChart = lazy(() => import('./InsightsChart'));

const ranges = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
] as const;

export default function VendorInsights() {
  const [params, setParams] = useSearchParams();
  const days = ranges.find((r) => String(r.days) === params.get('days'))?.days ?? 30;
  const { data, isPending, error } = useVendorAnalytics(days);

  return (
    <>
      <PageHead title="Insights" />
      <div className="tabs" role="tablist" aria-label="Date range">
        {ranges.map((r) => (
          <button
            key={r.days}
            type="button"
            role="tab"
            aria-selected={days === r.days}
            className={days === r.days ? 'active' : ''}
            onClick={() => setParams(r.days === 30 ? {} : { days: String(r.days) }, { replace: true })}
          >
            Last {r.label}
          </button>
        ))}
      </div>
      {isPending ? <Loading /> : error ? <ErrorNote error={error} /> : <Report data={data} />}
    </>
  );
}

function isEmpty(a: VendorAnalytics) {
  const t = a.totals;
  const sum = t.views + t.clicks + t.saves + t.whatsapp + t.calls + t.directions;
  return sum + a.scratch.won + a.scratch.claimed === 0;
}

/** One point per day in the range, with zeros for quiet days. */
function chartDays(a: VendorAnalytics): ChartDay[] {
  const byDay = new Map(a.daily.map((d) => [d.day, d]));
  const out: ChartDay[] = [];
  for (let day = a.from; day <= a.to; day = addDays(day, 1)) {
    const d = byDay.get(day);
    out.push({
      label: shortDay(day),
      views: d?.views ?? 0,
      clicks: d?.clicks ?? 0,
      whatsapp: d?.whatsapp ?? 0,
    });
  }
  return out;
}

const cell = { padding: '10px 12px', whiteSpace: 'nowrap' } as const;

function Report({ data: a }: { data: VendorAnalytics }) {
  const t = a.totals;
  const tiles = [
    { label: 'Views', value: t.views, hint: 'Shop page or offer opened' },
    { label: 'Offer taps', value: t.clicks, hint: 'Offer tapped in a list' },
    { label: 'Saves', value: t.saves, hint: 'Saved by a customer' },
    { label: 'WhatsApp leads', value: t.whatsapp, hint: 'WhatsApp button pressed' },
    { label: 'Calls', value: t.calls, hint: 'Call button pressed' },
    { label: 'Directions', value: t.directions, hint: 'Map or directions opened' },
    { label: 'Scratch winners', value: a.scratch.won, hint: 'Won a prize you sponsor' },
    { label: 'Prizes claimed', value: a.scratch.claimed, hint: 'Collected at your shop' },
  ];

  if (isEmpty(a)) {
    return (
      <div className="saved-empty">
        <div className="emoji">📈</div>
        <h3>No activity yet</h3>
        <p>
          Your numbers appear here as customers find your shop: each time someone opens your shop or an offer,
          saves it, or taps WhatsApp, Call or Directions. Fresh offers help you get noticed.
        </p>
        <Link className="btn" to="/vendor/offers/new" style={{ display: 'inline-block', marginTop: 8 }}>
          ＋ Post an offer
        </Link>
      </div>
    );
  }

  const offers = [...a.offers].sort((x, y) => y.views - x.views || y.clicks - x.clicks);

  return (
    <>
      <p className="meta" style={{ margin: '0 0 10px' }}>
        {formatDate(a.from)} – {formatDate(a.to)} (India time)
      </p>
      <div className="info-grid">
        {tiles.map((x) => (
          <div key={x.label} className="info-card">
            <span>{x.label}</span>
            <strong>{num(x.value)}</strong>
            <span style={{ display: 'block', marginTop: 2, fontSize: 10 }}>{x.hint}</span>
          </div>
        ))}
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Day by day</h2>
        </div>
        <div className="manage-card">
          <Suspense fallback={<div style={{ height: 240 }} aria-busy="true" />}>
            <InsightsChart data={chartDays(a)} />
          </Suspense>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Your offers</h2>
        </div>
        {offers.length === 0 ? (
          <p className="meta" style={{ fontSize: 13 }}>
            None of your offers were opened in this period. Visits to your shop page still count in the totals
            above.
          </p>
        ) : (
          <div className="manage-card" style={{ padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ color: 'var(--color-muted)', textAlign: 'right' }}>
                  <th style={{ ...cell, textAlign: 'left' }}>Offer</th>
                  <th style={cell}>Views</th>
                  <th style={cell}>Taps</th>
                  <th style={cell}>Saves</th>
                  <th style={cell}>WhatsApp</th>
                  <th style={cell}>Tap rate</th>
                </tr>
              </thead>
              <tbody>
                {offers.map((o) => (
                  <tr
                    key={o.offer_id}
                    style={{ borderTop: '1px solid var(--color-line)', textAlign: 'right' }}
                  >
                    <td
                      style={{
                        ...cell,
                        textAlign: 'left',
                        whiteSpace: 'normal',
                        fontWeight: 700,
                        minWidth: 120,
                      }}
                    >
                      <Link to={`/vendor/offers/${o.offer_id}`} style={{ color: 'inherit' }}>
                        {o.title}
                      </Link>
                    </td>
                    <td style={cell}>{num(o.views)}</td>
                    <td style={cell}>{num(o.clicks)}</td>
                    <td style={cell}>{num(o.saves)}</td>
                    <td style={cell}>{num(o.whatsapp)}</td>
                    <td style={{ ...cell, fontWeight: 800 }}>{tapRate(o.clicks, o.views)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="meta" style={{ fontSize: 11, marginTop: 8 }}>
          Sorted by views. Tap rate = taps ÷ views. Visits to your shop page count in the totals, not against
          an offer.
        </p>
      </section>
    </>
  );
}
