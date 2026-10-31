import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { adExternalUrl, resolveAdPath } from '../customer/engagement';
import { usePlace } from '../lib/location';
import { db, must } from '../lib/queries';
import { mediaUrl, supabase } from '../lib/supabase';
import type { PopupContent, PopupIcon } from '../lib/types';
import { ArrowRight, Gift, Megaphone, Sparkles, Star, Ticket, X, type LucideIcon } from 'lucide-react';
import { Icon } from './Icon';

// eslint-disable-next-line react-refresh/only-export-components
export const POPUP_ICONS: { key: PopupIcon; label: string; icon: LucideIcon }[] = [
  { key: 'star', label: 'Points', icon: Star },
  { key: 'gift', label: 'Gift', icon: Gift },
  { key: 'ticket', label: 'Ticket', icon: Ticket },
  { key: 'megaphone', label: 'Megaphone', icon: Megaphone },
  { key: 'sparkles', label: 'Sparkles', icon: Sparkles },
];

/** The pop-up box itself, shared by the customer app and the admin preview. */
export function PopupCard({
  popup,
  onClose,
  onTap,
  titleId,
}: {
  popup: Omit<PopupContent, 'id'>;
  onClose?: () => void;
  onTap?: () => void;
  /** Set on the open pop-up so the dialog is named by its title. */
  titleId?: string;
}) {
  const glyph = POPUP_ICONS.find((i) => i.key === popup.icon)?.icon ?? Star;
  const hasButton = popup.link_kind !== 'none' && Boolean(popup.link_target);
  const bullets = popup.bullets.filter((b) => b.trim());
  return (
    <div className={`popup-card ${popup.style}`}>
      <button type="button" className="popup-x" aria-label="Close" onClick={onClose}>
        <Icon icon={X} size={18} />
      </button>
      {popup.style === 'picture' ? (
        <div className="popup-poster">
          {popup.image_key ? (
            <img src={mediaUrl(popup.image_key)} alt="" decoding="async" />
          ) : (
            <span>Add a 4:5 picture</span>
          )}
        </div>
      ) : (
        <div className="popup-head">
          <div className="popup-medal">
            <Icon icon={glyph} size={36} />
          </div>
          {popup.tag && <span className="popup-tag">{popup.tag}</span>}
          <h3 id={titleId}>{popup.title || 'Title'}</h3>
        </div>
      )}
      <div className="popup-body">
        {popup.style === 'picture' && (
          <>
            {popup.tag && <span className="popup-tag soft">{popup.tag}</span>}
            <h3 id={titleId}>{popup.title || 'Title'}</h3>
          </>
        )}
        {popup.message && <p>{popup.message}</p>}
        {bullets.length > 0 && (
          <ol className="popup-points">
            {bullets.map((b, i) => (
              <li key={i}>
                <i>{i + 1}</i>
                {b}
              </li>
            ))}
          </ol>
        )}
        {hasButton && (
          <button
            type="button"
            className={`popup-cta${popup.style === 'card' ? ' yellow' : ''}`}
            onClick={onTap}
          >
            {popup.button_text || 'Open'} <Icon icon={ArrowRight} size={18} />
          </button>
        )}
        <button type="button" className="popup-later" onClick={onClose}>
          {hasButton ? 'Maybe later' : 'Close'}
        </button>
      </div>
    </div>
  );
}

/** Dimmed full-screen layer with the pop-up in the middle; Escape or a tap outside closes it. */
export function PopupLayer({
  popup,
  onClose,
  onTap,
}: {
  popup: Omit<PopupContent, 'id'>;
  onClose: () => void;
  onTap?: () => void;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', key);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  return createPortal(
    <div
      className="popup-layer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="popup-title"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <PopupCard popup={popup} onClose={onClose} onTap={onTap} titleId="popup-title" />
    </div>,
    document.body,
  );
}

const SHOWN_KEY = 'iwillfly-popup-shown';

function shownThisVisit() {
  try {
    return sessionStorage.getItem(SHOWN_KEY) === '1';
  } catch {
    return false;
  }
}

function markShown() {
  try {
    sessionStorage.setItem(SHOWN_KEY, '1');
  } catch {
    /* storage unavailable */
  }
}

function popupEvent(id: number, event: 'seen' | 'tap' | 'close') {
  if (!supabase) return;
  void supabase.rpc('popup_event', { p_popup_id: id, p_event: event }).then(
    () => undefined,
    () => undefined,
  );
}

/**
 * The admin's announcement pop-up for this customer, if one is running for their area. At most one per
 * visit; the server decides how often a customer sees the same one again.
 */
export function AnnouncementPopup() {
  const { session } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { place } = usePlace();
  const page = pathname === '/' ? 'home' : 'other';
  const areaId = typeof place?.source === 'number' ? place.source : null;
  const [done, setDone] = useState(shownThisVisit);
  const [open, setOpen] = useState<PopupContent | null>(null);
  const seen = useRef<number | null>(null);

  const query = useQuery({
    queryKey: ['my_popup', session?.user.id ?? null, page, areaId],
    queryFn: async () =>
      must<PopupContent[]>(await db().rpc('my_popup', { p_location_id: areaId, p_page: page }))[0] ?? null,
    enabled: Boolean(supabase && session) && !done,
    staleTime: Infinity,
    retry: false,
  });

  // A short pause, so the page draws first and the pop-up does not flash in while it loads.
  useEffect(() => {
    const p = query.data;
    if (done || !p) return;
    const t = window.setTimeout(() => {
      setOpen(p);
      setDone(true);
      markShown();
      if (seen.current !== p.id) {
        seen.current = p.id;
        popupEvent(p.id, 'seen');
      }
    }, 1200);
    return () => window.clearTimeout(t);
  }, [query.data, done]);

  if (!open) return null;
  const close = () => {
    popupEvent(open.id, 'close');
    setOpen(null);
  };
  const tap = async () => {
    popupEvent(open.id, 'tap');
    const p = open;
    setOpen(null);
    if (p.link_kind === 'page') {
      if (p.link_target?.startsWith('/')) navigate(p.link_target);
      return;
    }
    const url = adExternalUrl(p);
    if (url) {
      window.open(url, '_blank', 'noopener');
      return;
    }
    const path = await resolveAdPath(p).catch(() => null);
    if (path) navigate(path);
  };
  return <PopupLayer popup={open} onClose={close} onTap={() => void tap()} />;
}
