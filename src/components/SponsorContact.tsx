import { Link } from 'react-router-dom';
import { formatCode } from '../lib/scratch';
import type { PlayResult } from '../lib/types';
import { ContactButtons } from './ContactButtons';

/**
 * Lets a winner contact the shop that hands their prize over: call, WhatsApp (with a message about the
 * prize ready to send) or open the shop page for its address and hours.
 */
export function SponsorContact({ result }: { result: PlayResult }) {
  const s = result.sponsor;
  if (!s) {
    return (
      <div className="meta" style={{ marginTop: 10, textAlign: 'center' }}>
        This prize is from IWILLFLY. Questions? <Link to="/help">Contact support</Link>
      </div>
    );
  }
  const code = result.claim_code ? ` My claim code is ${formatCode(result.claim_code)}.` : '';
  const message = `Hi ${s.name}, I won "${result.prize?.name ?? 'a prize'}" in IWILLFLY Scratch & Win.${code} When can I collect it?`;
  const hasNumber = Boolean(s.phone || s.whatsapp);
  return (
    <div className="contact-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="contact-icon">🏬</div>
        <div style={{ minWidth: 0, textAlign: 'left' }}>
          <b>Contact {s.name}</b>
          <div className="meta">
            {hasNumber
              ? 'Ask about timings or how to collect your prize.'
              : 'Visit the shop with your claim code.'}
          </div>
        </div>
      </div>
      <ContactButtons
        phone={s.phone}
        whatsapp={s.whatsapp}
        message={message}
        showNumber={false}
        extra={
          s.shop_id ? (
            <Link className="contact-btn" to={`/shop/${s.shop_id}`}>
              📍 View shop
            </Link>
          ) : undefined
        }
      />
    </div>
  );
}
