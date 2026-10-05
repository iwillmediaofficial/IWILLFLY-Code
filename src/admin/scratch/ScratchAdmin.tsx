import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { formatTime } from '../../lib/scratch';
import { locationPath } from '../../lib/locationPath';
import { useLocations } from '../../lib/queries';
import { mediaUrl } from '../../lib/supabase';
import { Empty, ErrorNotice, Loading } from '../ui';
import { formatDate } from '../util';
import { campaignStatus, useCampaigns } from './api';
import { CampaignEdit } from './CampaignEdit';
import { StatusPill } from './StatusPill';

export default function ScratchAdmin() {
  return (
    <Routes>
      <Route index element={<CampaignList />} />
      <Route path="new" element={<CampaignEdit />} />
      <Route path=":id" element={<CampaignEdit />} />
      <Route path="*" element={<Navigate to="/admin/scratch" replace />} />
    </Routes>
  );
}

function CampaignList() {
  const { data: locations = [] } = useLocations();
  const campaigns = useCampaigns();

  return (
    <>
      <div className="section-head">
        <h2>Scratch &amp; Win</h2>
        <Link className="btn small" to="/admin/scratch/new">
          ＋ New campaign
        </Link>
      </div>
      {campaigns.isPending && <Loading />}
      {campaigns.error && <ErrorNotice error={campaigns.error} />}
      {campaigns.data?.length === 0 && (
        <Empty emoji="🎟️" title="No campaigns yet">
          Create a campaign, add its prizes, then switch it on.
        </Empty>
      )}
      <div className="list">
        {campaigns.data?.map((c) => (
          <Link key={c.id} className="shop-card" to={`/admin/scratch/${c.id}`}>
            <div className="shop-thumb">
              {c.banner_key ? <img src={mediaUrl(c.banner_key)} alt="" /> : '🎟️'}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ marginBottom: 4 }}>
                <StatusPill status={campaignStatus(c)} />
              </div>
              <h4>{c.name}</h4>
              <div className="meta">
                {formatDate(c.starts_on)} – {c.ends_on ? formatDate(c.ends_on) : 'no end date'} ·{' '}
                {formatTime(c.active_from)}–{formatTime(c.active_to)}
              </div>
              <div className="meta">
                {c.location_id != null ? locationPath(locations, c.location_id) || 'Area' : 'All areas'} ·{' '}
                {c.scratch_prizes[0]?.count ?? 0} prizes · {c.campaign_vendors[0]?.count ?? 0} vendors
              </div>
            </div>
            <div className="chev">›</div>
          </Link>
        ))}
      </div>
    </>
  );
}
