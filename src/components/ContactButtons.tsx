import type { ReactNode } from 'react';
import { formatPhone, telHref, waHref } from '../lib/contact';

/**
 * Call and WhatsApp buttons for a phone number, with an optional ready-made WhatsApp message.
 * WhatsApp uses its own number when given, else the phone. Renders nothing without any number.
 */
export function ContactButtons({
  phone,
  whatsapp,
  message,
  extra,
  showNumber = true,
}: {
  phone?: string | null;
  whatsapp?: string | null;
  message?: string;
  /** More buttons after Call and WhatsApp, e.g. "View shop". */
  extra?: ReactNode;
  showNumber?: boolean;
}) {
  const wa = whatsapp || phone;
  if (!phone && !wa && !extra) return null;
  return (
    <div className="contact-row">
      {showNumber && phone && <span className="contact-number">📞 {formatPhone(phone)}</span>}
      <div className="contact-btns">
        {phone && (
          <a className="contact-btn call" href={telHref(phone)}>
            📞 Call
          </a>
        )}
        {wa && (
          <a className="contact-btn wa" href={waHref(wa, message)} target="_blank" rel="noreferrer">
            💬 WhatsApp
          </a>
        )}
        {extra}
      </div>
    </div>
  );
}
