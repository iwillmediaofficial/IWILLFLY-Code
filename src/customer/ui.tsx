import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { mediaUrl, supabase } from '../lib/supabase';
import { errorText } from './util';

/** Shown in place of live data when the app was built without Supabase keys. */
export function NoBackend() {
  return <div className="notice warn">Live offers are not connected yet. Please check back soon.</div>;
}

/** Renders children only when Supabase is configured. */
export function NeedsBackend({ children }: { children: ReactNode }) {
  return supabase ? <>{children}</> : <NoBackend />;
}

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return (
    <div className="meta" style={{ padding: '12px 2px' }}>
      {text}
    </div>
  );
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="notice bad">
      {errorText(error)}
      {onRetry && (
        <>
          {' '}
          <button className="link-btn" onClick={onRetry}>
            Try again
          </button>
        </>
      )}
    </div>
  );
}

/** Square thumbnail: an uploaded image when there is one, otherwise an emoji icon. */
export function Thumb({ imageKey, icon }: { imageKey?: string | null; icon?: string | null }) {
  return (
    <div className="shop-thumb">
      {imageKey ? <img src={mediaUrl(imageKey)} alt="" loading="lazy" /> : (icon ?? '🏪')}
    </div>
  );
}

const fill: CSSProperties = { position: 'absolute', inset: 0 };
const above: CSSProperties = { position: 'relative' };

/** The coloured offer tile header with a badge; a cover image fills it when present. */
export function OfferImage({
  imageKey,
  icon,
  badge,
  tone = '',
  style,
}: {
  imageKey?: string | null;
  icon?: string | null;
  badge?: string | null;
  tone?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`offer-image${tone ? ` ${tone}` : ''}`}
      style={imageKey ? { position: 'relative', overflow: 'hidden', ...style } : style}
    >
      {imageKey && <img src={mediaUrl(imageKey)} alt="" loading="lazy" style={fill} />}
      {badge ? (
        <span className="badge" style={imageKey ? above : undefined}>
          {badge}
        </span>
      ) : (
        <span />
      )}
      {!imageKey && <b>{icon ?? '🎁'}</b>}
    </div>
  );
}

/** Bottom sheet using the prototype's .modal/.sheet styles. Locks page scroll while open. */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  return (
    <div
      className={`modal${open ? ' show' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="sheet">
        <div className="sheet-head" style={{ marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>{title}</h2>
            {subtitle && <div className="meta">{subtitle}</div>}
          </div>
          <button className="close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {open && children}
      </div>
    </div>
  );
}
