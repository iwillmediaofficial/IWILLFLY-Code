import { mediaUrl } from '../../lib/supabase';
import type { ScratchCampaign, Vendor } from '../../lib/types';
import { campaignPhase, campaignPhaseClass, campaignPhaseLabel, campaignWhen } from './format';

/** Banner, name, dates and status of a campaign. */
export function CampaignSummary({
  campaign: c,
  joined,
  full = false,
}: {
  campaign: ScratchCampaign;
  joined: boolean;
  full?: boolean;
}) {
  const phase = campaignPhase(c);
  return (
    <>
      {c.banner_key && (
        <img
          src={mediaUrl(c.banner_key)}
          alt=""
          loading="lazy"
          decoding="async"
          style={{
            width: '100%',
            aspectRatio: full ? '16 / 7' : '16 / 5',
            objectFit: 'cover',
            borderRadius: 14,
            display: 'block',
            marginBottom: 10,
          }}
        />
      )}
      <h4>{c.name}</h4>
      <div className="meta">{campaignWhen(c)}</div>
      {(full || !c.banner_key) && c.description && (
        <p style={{ fontSize: 13, margin: '6px 0 0', lineHeight: 1.5 }}>{c.description}</p>
      )}
      {full && (
        <div className="meta" style={{ marginTop: 6 }}>
          Winners have {c.claim_valid_days} {c.claim_valid_days === 1 ? 'day' : 'days'} to collect their
          prize.
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        <span className={`pill-status ${campaignPhaseClass[phase]}`}>{campaignPhaseLabel[phase]}</span>
        {joined && <span className="pill-status approved">Joined</span>}
      </div>
    </>
  );
}

/** Why this vendor can't join campaigns yet, or null when they can. */
export function JoinBlockedNote({ vendor }: { vendor: Vendor }) {
  if (vendor.status === 'approved') return null;
  if (vendor.status === 'blocked') {
    return (
      <div className="notice bad">
        Your account is blocked, so you can't join campaigns or change prizes. See the dashboard for details.
      </div>
    );
  }
  return (
    <div className="notice warn">
      <b>Joining needs an approved business.</b> You can join Scratch & Win campaigns and sponsor prizes once
      the IWILLFLY team approves your account.
    </div>
  );
}
