import { Empty, ErrorNotice, Loading } from '../ui';
import { useStats } from './api';

const COLS = [
  { key: 'quantity', label: 'Quantity' },
  { key: 'given_out', label: 'Given out' },
  { key: 'won', label: 'Won' },
  { key: 'claimed', label: 'Claimed' },
  { key: 'unclaimed', label: 'Unclaimed' },
  { key: 'expired', label: 'Expired' },
] as const;

export function Stats({ campaignId }: { campaignId: number }) {
  const stats = useStats(campaignId);
  const rows = stats.data ?? [];
  const first = rows[0];
  const allMatch = rows.every((r) => r.given_out === r.won);
  const totals = COLS.map((c) => rows.reduce((sum, r) => sum + r[c.key], 0));

  const cell = { padding: '8px 6px', textAlign: 'right' as const, whiteSpace: 'nowrap' as const };
  const line = '1px solid var(--color-line)';

  return (
    <section>
      <div className="section-head">
        <h2>Stats</h2>
        <button className="link-btn" disabled={stats.isFetching} onClick={() => stats.refetch()}>
          {stats.isFetching ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>
      {stats.isPending && <Loading />}
      {stats.error && <ErrorNotice error={stats.error} />}
      {stats.data && rows.length === 0 && (
        <Empty emoji="📊" title="No prizes yet">
          Add prizes to see stock and claims here.
        </Empty>
      )}
      {first && (
        <>
          <div className="info-grid" style={{ marginBottom: 12 }}>
            <div className="info-card">
              <strong>{first.plays_total}</strong>
              <span>Scratches played</span>
            </div>
            <div className="info-card">
              <strong>{first.players}</strong>
              <span>Players</span>
            </div>
          </div>
          <div
            className="notice"
            style={
              allMatch
                ? { background: '#e8f8ef', color: '#0e8a43', fontWeight: 800 }
                : { background: '#fff0f1', color: 'var(--color-red)', fontWeight: 800 }
            }
          >
            {allMatch
              ? '✓ Stock matches wins: every prize given out was won by a customer.'
              : '✕ Stock does not match wins for the rows marked below. Check for hand-edited stock.'}
          </div>
          <div className="manage-card" style={{ overflowX: 'auto', padding: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: line, color: 'var(--color-muted)' }}>
                  <th style={{ ...cell, textAlign: 'left' }}>Prize</th>
                  {COLS.map((c) => (
                    <th key={c.key} style={cell}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const ok = r.given_out === r.won;
                  return (
                    <tr
                      key={r.prize_id}
                      style={{ borderBottom: line, background: ok ? undefined : '#fff0f1' }}
                    >
                      <td style={{ ...cell, textAlign: 'left', whiteSpace: 'normal', fontWeight: 700 }}>
                        {ok ? '' : '✕ '}
                        {r.prize_name}
                        <div className="meta" style={{ fontWeight: 400 }}>
                          {r.remaining} left
                        </div>
                      </td>
                      {COLS.map((c) => (
                        <td
                          key={c.key}
                          style={{
                            ...cell,
                            color:
                              !ok && (c.key === 'given_out' || c.key === 'won')
                                ? 'var(--color-red)'
                                : undefined,
                          }}
                        >
                          {r[c.key]}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                <tr style={{ fontWeight: 800 }}>
                  <td style={{ ...cell, textAlign: 'left' }}>Total</td>
                  {totals.map((t, i) => (
                    <td key={COLS[i].key} style={cell}>
                      {t}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
