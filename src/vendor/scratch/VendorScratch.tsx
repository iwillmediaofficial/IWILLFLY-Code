import { useState } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import type { ClaimStatus, ScratchCampaign } from '../../lib/types';
import { useVendor } from '../context';
import { errorMessage } from '../format';
import { ErrorNote, Loading, Lockable, PageHead } from '../ui';
import { useCampaignLists, useJoinCampaign, useVendorWinners } from './api';
import { CampaignSummary, JoinBlockedNote } from './CampaignBits';
import CampaignPage from './CampaignPage';
import ClaimPage from './ClaimPage';
import { claimLabel } from './format';
import { WinnersList } from './WinnersList';

export default function VendorScratch() {
  return (
    <Routes>
      <Route index element={<ScratchHome />} />
      <Route path="claim" element={<ClaimPage />} />
      <Route path=":campaignId" element={<CampaignPage />} />
    </Routes>
  );
}

function ScratchHome() {
  const vendor = useVendor();
  const { joined, available, isPending, error } = useCampaignLists();
  const winners = useVendorWinners(null);
  const [filter, setFilter] = useState<ClaimStatus>('unclaimed');
  const count = (s: ClaimStatus) =>
    winners.isPending ? '…' : (winners.data ?? []).filter((w) => w.claim_status === s).length;

  return (
    <>
      <PageHead title="Scratch & Win" />
      <Link
        className="btn yellow block"
        to="/vendor/scratch/claim"
        style={{
          display: 'block',
          textAlign: 'center',
          padding: '20px 16px',
          fontSize: 17,
          marginBottom: 12,
        }}
      >
        📷 Verify a prize
        <span style={{ display: 'block', fontSize: 12, fontWeight: 600, marginTop: 4 }}>
          Scan the winner's QR code or type their claim code
        </span>
      </Link>

      <div className="info-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {(['unclaimed', 'claimed', 'expired'] as const).map((s) => (
          <button
            key={s}
            type="button"
            className="info-card"
            style={{
              textAlign: 'left',
              cursor: 'pointer',
              font: 'inherit',
              color: 'inherit',
              borderColor: filter === s ? 'var(--color-blue)' : undefined,
            }}
            onClick={() => {
              setFilter(s);
              document.getElementById('scratch-winners')?.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            <span>{s === 'unclaimed' ? 'Waiting to collect' : claimLabel[s]}</span>
            <strong>{count(s)}</strong>
          </button>
        ))}
      </div>

      <section className="section">
        <JoinBlockedNote vendor={vendor} />
        <div className="section-head">
          <h2>Your campaigns</h2>
        </div>
        {isPending ? (
          <Loading />
        ) : error ? (
          <ErrorNote error={error} />
        ) : joined.length === 0 ? (
          <p className="meta" style={{ fontSize: 13 }}>
            You haven't joined a campaign yet. Join one below to give away prizes from your shop.
          </p>
        ) : (
          <div className="list">
            {joined.map((c) => (
              <Link
                key={c.id}
                to={`/vendor/scratch/${c.id}`}
                className="manage-card"
                style={{ marginTop: 0, display: 'block' }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <CampaignSummary campaign={c} joined />
                  </div>
                  <div className="chev">›</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {!isPending && !error && (
        <section className="section">
          <div className="section-head">
            <h2>Campaigns to join</h2>
          </div>
          {available.length === 0 ? (
            <p className="meta" style={{ fontSize: 13 }}>
              No other campaigns are running right now. New ones appear here when IWILLFLY starts them.
            </p>
          ) : (
            <Lockable locked={vendor.status === 'blocked'}>
              <div className="list">
                {available.map((c) => (
                  <AvailableCampaign key={c.id} campaign={c} canJoin={vendor.status === 'approved'} />
                ))}
              </div>
            </Lockable>
          )}
        </section>
      )}

      <section className="section" id="scratch-winners">
        <div className="section-head">
          <h2>Your winners</h2>
        </div>
        <WinnersList
          winners={winners.data}
          isPending={winners.isPending}
          error={winners.error}
          showCampaign
          filter={filter}
          onFilter={setFilter}
        />
      </section>
    </>
  );
}

function AvailableCampaign({ campaign, canJoin }: { campaign: ScratchCampaign; canJoin: boolean }) {
  const toast = useToast();
  const membership = useJoinCampaign();
  return (
    <div className="manage-card" style={{ marginTop: 0 }}>
      <CampaignSummary campaign={campaign} joined={false} />
      <div className="btn-row">
        {canJoin && (
          <button
            type="button"
            className="btn small"
            disabled={membership.isPending}
            onClick={() =>
              membership.mutate(
                { campaignId: campaign.id, join: true },
                {
                  onSuccess: () => toast(`Joined ${campaign.name}`),
                  onError: (e) => toast(errorMessage(e)),
                },
              )
            }
          >
            {membership.isPending ? 'Joining…' : 'Join'}
          </button>
        )}
        <Link className="btn secondary small" to={`/vendor/scratch/${campaign.id}`}>
          Details
        </Link>
      </div>
    </div>
  );
}
