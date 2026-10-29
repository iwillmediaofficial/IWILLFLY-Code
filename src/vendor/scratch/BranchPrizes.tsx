import { Link } from 'react-router-dom';
import type { Branch } from '../../lib/types';
import { useCanEditPrizes } from '../context';
import { ErrorNote, Loading } from '../ui';
import { useCampaignLists, useMyPrizes } from './api';
import { Gift } from 'lucide-react';
import { Icon } from '../../components/Icon';

/** On a branch page: the Scratch & Win prizes collected at this branch, and where to add one. */
export function BranchPrizes({ branch }: { branch: Branch }) {
  const prizes = useMyPrizes(null);
  const { all, joined, isPending, error } = useCampaignLists();
  const canEdit = useCanEditPrizes() && branch.review_status !== 'rejected';
  if (prizes.isPending || isPending) return <Loading />;
  if (prizes.error || error) return <ErrorNote error={prizes.error ?? error} />;

  const here = (prizes.data ?? []).filter((p) => p.all_branches || p.branch_ids.includes(branch.id));
  const campaignName = (id: number) => all.find((c) => c.id === id)?.name ?? 'Campaign';
  const running = joined.filter((c) => c.is_active);

  return (
    <section className="section">
      <div className="section-head">
        <h2>Scratch &amp; Win prizes</h2>
        <Link to="/vendor/scratch">All campaigns</Link>
      </div>
      {here.length === 0 ? (
        <p className="meta" style={{ marginTop: 0 }}>
          No prizes are collected at this branch yet.
        </p>
      ) : (
        <div className="list">
          {here.map((p) => (
            <Link
              key={p.id}
              to={`/vendor/scratch/${p.campaign_id}`}
              className="shop-card"
              style={{ alignItems: 'start' }}
            >
              <div className="shop-thumb">
                <Icon icon={Gift} />
              </div>
              <div style={{ minWidth: 0 }}>
                <h4>{p.name}</h4>
                <div className="meta">
                  {campaignName(p.campaign_id)} · <b>{p.remaining}</b> of {p.quantity} left
                  {p.all_branches ? ' · all branches' : ''}
                </div>
                <div style={{ marginTop: 6 }}>
                  {p.is_active ? (
                    <span className="pill-status live">Live</span>
                  ) : (
                    <span className="pill-status pending">Waiting for IWILLFLY</span>
                  )}
                </div>
              </div>
              <span className="meta">›</span>
            </Link>
          ))}
        </div>
      )}
      {canEdit &&
        (running.length > 0 ? (
          <div className="btn-row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
            {running.map((c) => (
              <Link
                key={c.id}
                className="btn secondary"
                to={`/vendor/scratch/${c.id}?add=1&branch=${branch.id}`}
              >
                ＋ Add a prize for this branch{running.length > 1 ? ` · ${c.name}` : ''}
              </Link>
            ))}
          </div>
        ) : (
          <p className="meta">
            To add prizes, your business first joins a running campaign in{' '}
            <Link to="/vendor/scratch">Scratch &amp; Win</Link>.
          </p>
        ))}
    </section>
  );
}
