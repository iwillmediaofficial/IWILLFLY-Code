import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { track } from '../lib/engagement';
import { parkingInfo } from '../lib/parking';
import type { Parking } from '../lib/types';
import { Icon } from '../components/Icon';
import { OfferImage } from './ui';

/** The prototype offer card. Tapping counts a click for the shop and offer, then opens the offer. */
export function OfferTile({
  shopId,
  offerId,
  shopPath,
  imageKey,
  icon,
  badge,
  tone,
  title,
  meta,
  sponsored,
  parking,
  onOpen,
}: {
  shopId: number;
  offerId: number;
  /** Opens this path (e.g. the branch page) instead of /shop/<id>. */
  shopPath?: string;
  imageKey?: string | null;
  icon?: ReactNode;
  badge: string;
  tone: string;
  title: string;
  meta: string;
  /** Paid placement (Top Picks): shows a small "Sponsored" tag. */
  sponsored?: boolean;
  /** The branch's parking, shown as a small coloured tag; nothing when the branch hasn't set it. */
  parking?: Parking | null;
  onOpen?: () => void;
}) {
  const navigate = useNavigate();
  const park = parkingInfo(parking);
  const open = () => {
    track('click', shopId, offerId);
    onOpen?.();
    navigate(`${shopPath ?? `/shop/${shopId}`}?offer=${offerId}`);
  };
  return (
    <article
      className="offer-card"
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => e.key === 'Enter' && open()}
    >
      <OfferImage imageKey={imageKey} icon={icon} badge={badge} tone={tone} />
      <div className="offer-body">
        {sponsored && <span className="sponsored">Sponsored</span>}
        <h4>{title}</h4>
        <div className="meta">{meta}</div>
        {park && (
          <div className={`park-tag ${park.value}`} title={park.label}>
            <Icon icon={park.icon} />
            <span>{park.tag}</span>
          </div>
        )}
        <div className="offer-cta">
          <strong>View offer</strong>
          <span>→</span>
        </div>
      </div>
    </article>
  );
}
