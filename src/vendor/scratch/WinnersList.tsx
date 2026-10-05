import { useState } from 'react';
import type { ClaimStatus, VendorWinner } from '../../lib/types';
import { ErrorNote, Loading } from '../ui';
import { claimClass, claimLabel, formatDateTime } from './format';

const filters: { key: ClaimStatus; label: string }[] = [
  { key: 'unclaimed', label: 'Waiting' },
  { key: 'claimed', label: 'Handed over' },
  { key: 'expired', label: 'Expired' },
];

const PAGE = 20;

/** Winners of the vendor's prizes with Waiting / Handed over / Expired filters. */
export function WinnersList({
  winners,
  isPending,
  error,
  showCampaign,
  filter,
  onFilter,
}: {
  winners: VendorWinner[] | undefined;
  isPending: boolean;
  error: unknown;
  showCampaign: boolean;
  filter: ClaimStatus;
  onFilter: (f: ClaimStatus) => void;
}) {
  const [limit, setLimit] = useState(PAGE);
  const count = (key: ClaimStatus) => (winners ?? []).filter((w) => w.claim_status === key).length;
  const shown = (winners ?? []).filter((w) => w.claim_status === filter);

  return (
    <>
      <div className="tabs" role="tablist">
        {filters.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            aria-selected={filter === x.key}
            className={filter === x.key ? 'active' : ''}
            onClick={() => {
              onFilter(x.key);
              setLimit(PAGE);
            }}
          >
            {x.label}
            {winners ? ` (${count(x.key)})` : ''}
          </button>
        ))}
      </div>
      {isPending ? (
        <Loading />
      ) : error ? (
        <ErrorNote error={error} />
      ) : shown.length === 0 ? (
        <p className="meta" style={{ textAlign: 'center', padding: 16 }}>
          {filter === 'unclaimed'
            ? 'No winners are waiting to collect a prize.'
            : filter === 'claimed'
              ? 'No prizes handed over yet.'
              : 'No expired prizes.'}
        </p>
      ) : (
        <div className="list">
          {shown.slice(0, limit).map((w) => (
            <WinnerRow key={w.play_id} winner={w} showCampaign={showCampaign} />
          ))}
          {shown.length > limit && (
            <button type="button" className="btn secondary block" onClick={() => setLimit((n) => n + PAGE)}>
              Show more ({shown.length - limit} left)
            </button>
          )}
        </div>
      )}
    </>
  );
}

function WinnerRow({ winner: w, showCampaign }: { winner: VendorWinner; showCampaign: boolean }) {
  return (
    <div className="manage-card" style={{ marginTop: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          <h4>{w.prize_name}</h4>
          <div className="meta">
            {w.customer_name}
            {showCampaign && ` · ${w.campaign_name}`}
          </div>
        </div>
        <span className={`pill-status ${claimClass[w.claim_status]}`} style={{ flex: 'none' }}>
          {claimLabel[w.claim_status]}
        </span>
      </div>
      <div className="meta" style={{ marginTop: 4 }}>
        Won {formatDateTime(w.played_at)}
        {w.claim_status === 'claimed' && w.claimed_at && ` · Handed over ${formatDateTime(w.claimed_at)}`}
        {w.claim_status === 'unclaimed' && ` · Collect by ${formatDateTime(w.expires_at)}`}
        {w.claim_status === 'expired' && ` · Expired ${formatDateTime(w.expires_at)}`}
      </div>
    </div>
  );
}
