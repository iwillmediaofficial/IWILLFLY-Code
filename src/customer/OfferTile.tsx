import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { track } from '../lib/engagement';
import { OfferImage } from './ui';

/** The prototype offer card. Tapping counts a click for the shop and offer, then opens the offer. */
export function OfferTile({
  shopId,
  offerId,
  imageKey,
  icon,
  badge,
  tone,
  title,
  meta,
}: {
  shopId: number;
  offerId: number;
  imageKey?: string | null;
  icon?: ReactNode;
  badge: string;
  tone: string;
  title: string;
  meta: string;
}) {
  const navigate = useNavigate();
  const open = () => {
    track('click', shopId, offerId);
    navigate(`/shop/${shopId}?offer=${offerId}`);
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
        <h4>{title}</h4>
        <div className="meta">{meta}</div>
        <div className="offer-cta">
          <strong>View offer</strong>
          <span>→</span>
        </div>
      </div>
    </article>
  );
}
