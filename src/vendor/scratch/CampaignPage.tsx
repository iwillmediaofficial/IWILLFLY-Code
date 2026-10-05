import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import { mediaUrl } from '../../lib/supabase';
import type { ClaimStatus, ScratchCampaign, ScratchPrize } from '../../lib/types';
import { useVendor } from '../context';
import { errorMessage } from '../format';
import { ErrorNote, Loading, Lockable, NotFound, PageHead } from '../ui';
import { useCampaignLists, useJoinCampaign, useMyPrizes, useVendorWinners } from './api';
import { CampaignSummary, JoinBlockedNote } from './CampaignBits';
import { PrizeForm } from './PrizeForm';
import { WinnersList } from './WinnersList';

export default function CampaignPage() {
  const { campaignId } = useParams();
  const { all, joinedIds, isPending, error } = useCampaignLists();
  if (isPending) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  const campaign = all.find((c) => c.id === Number(campaignId));
  if (!campaign) return <NotFound what="Campaign" back="/vendor/scratch" />;
  return <CampaignDetail key={campaign.id} campaign={campaign} joined={joinedIds.has(campaign.id)} />;
}

function CampaignDetail({ campaign, joined }: { campaign: ScratchCampaign; joined: boolean }) {
  const vendor = useVendor();
  const toast = useToast();
  const navigate = useNavigate();
  const membership = useJoinCampaign();
  const prizes = useMyPrizes(campaign.id);
  const winners = useVendorWinners(campaign.id);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [filter, setFilter] = useState<ClaimStatus>('unclaimed');
  const locked = vendor.status === 'blocked';
  const canJoin = vendor.status === 'approved' && campaign.is_active;
  const myPrizes = prizes.data ?? [];

  const join = () =>
    membership.mutate(
      { campaignId: campaign.id, join: true },
      {
        onSuccess: () => toast('Joined. Now add the prizes you will give away.'),
        onError: (e) => toast(errorMessage(e)),
      },
    );

  const leave = () => {
    const note = myPrizes.length
      ? ' Prizes you already added stay in the campaign and winners can still collect them from you. Contact IWILLFLY to withdraw them.'
      : '';
    if (!confirm(`Leave "${campaign.name}"?${note}`)) return;
    membership.mutate(
      { campaignId: campaign.id, join: false },
      {
        onSuccess: () => {
          toast('You left the campaign');
          if (!campaign.is_active) navigate('/vendor/scratch', { replace: true });
        },
        onError: (e) => toast(errorMessage(e)),
      },
    );
  };

  return (
    <>
      <PageHead title="Campaign" action={<Link to="/vendor/scratch">All campaigns</Link>} />
      <div className="manage-card" style={{ marginBottom: 12 }}>
        <CampaignSummary campaign={campaign} joined={joined} full />
      </div>
      <JoinBlockedNote vendor={vendor} />

      <Lockable locked={locked}>
        {!joined && canJoin && (
          <div className="notice">
            Join this campaign to sponsor prizes. Customers who win your prize collect it at your shop.
            <button
              type="button"
              className="btn block"
              style={{ marginTop: 10 }}
              disabled={membership.isPending}
              onClick={join}
            >
              {membership.isPending ? 'Joining…' : 'Join campaign'}
            </button>
          </div>
        )}
        {!joined && !campaign.is_active && (
          <div className="notice warn">This campaign is not running, so it can't be joined.</div>
        )}

        <section className="section">
          <div className="section-head">
            <h2>Your prizes</h2>
            {joined && editing == null && !locked && (
              <button type="button" onClick={() => setEditing('new')}>
                ＋ Add prize
              </button>
            )}
          </div>
          {editing === 'new' && (
            <PrizeForm campaignId={campaign.id} prize={null} onDone={() => setEditing(null)} />
          )}
          {prizes.isPending ? (
            <Loading />
          ) : prizes.error ? (
            <ErrorNote error={prizes.error} />
          ) : myPrizes.length === 0 ? (
            <div className="saved-empty" style={{ padding: '28px 20px' }}>
              <div className="emoji">🎁</div>
              <h3>No prizes yet</h3>
              <p>
                {joined
                  ? 'Add a prize customers can win and collect at your shop.'
                  : 'Join the campaign to add prizes.'}
              </p>
            </div>
          ) : (
            <div className="list">
              {myPrizes.map((p) =>
                editing === p.id ? (
                  <PrizeForm key={p.id} campaignId={campaign.id} prize={p} onDone={() => setEditing(null)} />
                ) : (
                  <PrizeRow
                    key={p.id}
                    prize={p}
                    onEdit={editing == null && !locked ? () => setEditing(p.id) : undefined}
                  />
                ),
              )}
            </div>
          )}
        </section>

        <section className="section">
          <div className="section-head">
            <h2>Winners</h2>
            <Link to="/vendor/scratch/claim">Verify a prize</Link>
          </div>
          <WinnersList
            winners={winners.data}
            isPending={winners.isPending}
            error={winners.error}
            showCampaign={false}
            filter={filter}
            onFilter={setFilter}
          />
        </section>

        {joined && (
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <button type="button" className="link-btn" disabled={membership.isPending} onClick={leave}>
              Leave this campaign
            </button>
          </div>
        )}
      </Lockable>
    </>
  );
}

function PrizeRow({ prize: p, onEdit }: { prize: ScratchPrize; onEdit?: () => void }) {
  const won = p.quantity - p.remaining;
  return (
    <div className="shop-card" style={{ alignItems: 'start', cursor: 'default' }}>
      <div className="shop-thumb" style={{ overflow: 'hidden' }}>
        {p.image_key ? (
          <img
            src={mediaUrl(p.image_key)}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          '🎁'
        )}
      </div>
      <div style={{ minWidth: 0 }}>
        <h4>{p.name}</h4>
        {p.description && <div className="meta">{p.description}</div>}
        <div className="meta" style={{ marginTop: 2 }}>
          <b>{p.remaining}</b> of {p.quantity} left · {won} won
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          {p.is_active ? (
            <span className="pill-status live">Live</span>
          ) : (
            <span className="pill-status pending">Waiting for IWILLFLY</span>
          )}
          {p.is_active && p.remaining === 0 && <span className="pill-status rejected">Out of stock</span>}
        </div>
      </div>
      {onEdit ? (
        <button type="button" className="btn secondary small" onClick={onEdit}>
          Edit
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}
