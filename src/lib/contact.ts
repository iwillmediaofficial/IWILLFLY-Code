/** Digits for tel: and wa.me links. A 10-digit Indian mobile gets the 91 country code. */
function digits(phone: string) {
  const d = phone.replace(/\D/g, '');
  return d.length === 10 ? `91${d}` : d;
}

export function telHref(phone: string) {
  return `tel:+${digits(phone)}`;
}

/** WhatsApp chat link, optionally with a message typed in for the sender. */
export function waHref(phone: string, text?: string) {
  return `https://wa.me/${digits(phone)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

/** "+91 98765 43210" for display. */
export function formatPhone(phone: string) {
  const d = digits(phone);
  return d.length === 12 && d.startsWith('91') ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : phone;
}
