import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useToast } from '../../components/Toast';
import { formatCode } from '../../lib/scratch';
import type { CampaignWinner } from '../../lib/types';
import { Empty, ErrorNotice, Loading } from '../ui';
import { useInvalidate } from '../util';
import { SCRATCH_KEYS, confirmClaim, scratchError, setFraudFlag, useWinners } from './api';

type Filter = 'all' | 'unclaimed' | 'claimed' | 'expired' | 'flagged';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unclaimed', label: 'Unclaimed' },
  { key: 'claimed', label: 'Claimed' },
  { key: 'expired', label: 'Expired' },
  { key: 'flagged', label: 'Flagged' },
];

const STATUS_CLASS: Record<CampaignWinner['claim_status'], string> = {
  unclaimed: 'pending',
  claimed: 'approved',
  expired: '',
};

function when(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function matches(w: CampaignWinner, f: Filter) {
  if (f === 'all') return true;
  if (f === 'flagged') return w.fraud_flag;
  return w.claim_status === f;
}

export function Winners({ campaignId }: { campaignId: number }) {
  const winners = useWinners(campaignId);
  const [filter, setFilter] = useState<Filter>('all');
  const all = winners.data ?? [];
  const shown = all.filter((w) => matches(w, filter));
  const repeat = new Set(all.filter((w) => w.customer_wins > 1).map((w) => w.customer_id)).size;

  return (
    <section>
      <div className="section-head">
        <h2>Winners</h2>
        <span className="meta">{all.length} wins</span>
      </div>
      <div className="filter-bar" role="tablist" style={{ marginTop: 0 }}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            className={`chip${filter === f.key ? ' active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label} ({all.filter((w) => matches(w, f.key)).length})
          </button>
        ))}
      </div>
      {repeat > 0 && (
        <div className="notice warn">
          <b>{repeat}</b> {repeat === 1 ? 'customer has' : 'customers have'} won more than once in this
          campaign. Check them for fraud; they are marked below.
        </div>
      )}
      {winners.isPending && <Loading />}
      {winners.error && <ErrorNotice error={winners.error} />}
      {winners.data && shown.length === 0 && (
        <Empty emoji="🏆" title={filter === 'all' ? 'No winners yet' : 'Nobody here'}>
          {filter === 'all' ? 'Prizes won in this campaign will show up here.' : undefined}
        </Empty>
      )}
      {shown.map((w) => (
        <WinnerCard key={w.play_id} winner={w} />
      ))}
    </section>
  );
}

function WinnerCard({ winner: w }: { winner: CampaignWinner }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const repeat = w.customer_wins > 1;

  const flag = useMutation({
    mutationFn: (v: { flag: boolean; note: string | null }) => setFraudFlag(w.play_id, v.flag, v.note),
    onSuccess: (_, v) => {
      invalidate(...SCRATCH_KEYS);
      toast(v.flag === w.fraud_flag ? 'Note saved' : v.flag ? 'Win flagged' : 'Flag removed');
    },
    onError: (e) => toast(scratchError(e, 'Could not change this win.')),
  });

  const claim = useMutation({
    mutationFn: () => confirmClaim(w.claim_code),
    onSuccess: (res) => {
      invalidate(...SCRATCH_KEYS);
      if (res.status === 'claimed_now') toast('Prize marked as handed over');
      else if (res.status === 'flagged') toast('This win is flagged. Remove the flag first.');
      else if (res.status === 'not_found') toast('Claim code not found');
      else toast(`This prize is already ${res.status}`);
    },
    onError: (e) => toast(scratchError(e, 'Could not claim this prize.')),
  });

  const askNote = () => {
    const note = window.prompt(
      !w.fraud_flag
        ? `Flag this win by ${w.customer_name || 'this customer'}? A flagged prize cannot be claimed.\n\nReason:`
        : 'Fraud note:',
      w.fraud_note ?? (repeat ? `Won ${w.customer_wins} times in this campaign` : ''),
    );
    if (note === null) return;
    flag.mutate({ flag: true, note: note.trim().slice(0, 500) || null });
  };

  return (
    <div
      className="manage-card"
      style={
        w.fraud_flag
          ? { borderColor: 'var(--color-red)', boxShadow: '0 0 0 2px #fff0f1' }
          : repeat
            ? { borderColor: '#f5b45c', boxShadow: '0 0 0 2px #fff4e5' }
            : undefined
      }
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <h4>{w.prize_name}</h4>
          <div className="meta">Sponsor: {w.sponsor_name ?? 'IWILLFLY'}</div>
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <span className={`pill-status ${STATUS_CLASS[w.claim_status]}`}>{w.claim_status}</span>
          {w.fraud_flag && <span className="pill-status blocked">⚑ Flagged</span>}
          {repeat && <span className="pill-status pending">{w.customer_wins} wins</span>}
        </div>
      </div>
      <div style={{ fontSize: 13, marginTop: 6 }}>
        <b>{w.customer_name || 'No name'}</b>
        {w.customer_email && <span className="meta"> · {w.customer_email}</span>}
      </div>
      <div className="meta" style={{ marginTop: 4 }}>
        Code <b style={{ color: 'var(--color-ink)', letterSpacing: '0.05em' }}>{formatCode(w.claim_code)}</b>{' '}
        · won {when(w.played_at)} ·{' '}
        {w.claimed_at
          ? `claimed ${when(w.claimed_at)}`
          : `${w.claim_status === 'expired' ? 'expired' : 'expires'} ${when(w.expires_at)}`}
      </div>
      {w.fraud_note && (
        <div className={`notice ${w.fraud_flag ? 'bad' : 'warn'}`} style={{ marginTop: 10, marginBottom: 0 }}>
          <b>Note:</b> {w.fraud_note}
        </div>
      )}
      <div className="btn-row">
        {w.fraud_flag ? (
          <>
            <button
              className="btn small secondary"
              disabled={flag.isPending}
              onClick={() => {
                if (window.confirm('Remove the fraud flag? The customer can then claim this prize.'))
                  flag.mutate({ flag: false, note: w.fraud_note });
              }}
            >
              Remove flag
            </button>
            <button className="btn small secondary" disabled={flag.isPending} onClick={() => askNote()}>
              Edit note
            </button>
          </>
        ) : (
          <button className="btn small danger" disabled={flag.isPending} onClick={() => askNote()}>
            ⚑ Flag as fraud
          </button>
        )}
        {w.sponsor_name == null && w.claim_status === 'unclaimed' && !w.fraud_flag && (
          <button
            className="btn small"
            disabled={claim.isPending}
            onClick={() => {
              if (
                window.confirm(
                  `Mark ${w.prize_name} as handed over to ${w.customer_name || 'this customer'}?`,
                )
              )
                claim.mutate();
            }}
          >
            Mark claimed
          </button>
        )}
      </div>
    </div>
  );
}
