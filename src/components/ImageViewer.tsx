import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Icon } from './Icon';

const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;

interface Zoom {
  s: number;
  x: number;
  y: number;
}
const NO_ZOOM: Zoom = { s: 1, x: 0, y: 0 };

type Mode = 'idle' | 'pending' | 'swipe' | 'close' | 'pan' | 'pinch' | 'ignore';

/**
 * Full-screen dark viewer showing whole pictures. Swipe left/right (or the arrows / arrow keys)
 * between them, pinch or double-tap to zoom, swipe down, ✕ or Esc to close.
 */
export function ImageViewer({
  images,
  start,
  onClose,
}: {
  images: string[];
  start: number;
  onClose: () => void;
}) {
  const count = images.length;
  const [index, setIndex] = useState(() => Math.min(Math.max(start, 0), count - 1));
  const [zoom, setZoomState] = useState<Zoom>(NO_ZOOM);
  const [drag, setDrag] = useState(0);
  const [drop, setDrop] = useState(0);
  const [moving, setMoving] = useState(false);

  const stage = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const g = useRef({
    mode: 'idle' as Mode,
    x0: 0,
    y0: 0,
    t0: 0,
    zoom0: NO_ZOOM,
    dist0: 1,
    mid0: { x: 0, y: 0 },
    lastTap: { t: 0, x: 0, y: 0 },
  });
  // Gesture handlers read the latest zoom from here between renders.
  const zoomRef = useRef(NO_ZOOM);
  const setZoom = useCallback((z: Zoom) => {
    zoomRef.current = z;
    setZoomState(z);
  }, []);

  const go = useCallback(
    (i: number) => {
      if (i < 0 || i >= count) return;
      setIndex(i);
      setZoom(NO_ZOOM);
    },
    [count, setZoom],
  );

  // Esc closes only the viewer, not the offer popup underneath; arrows change picture.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(index + 1);
      else if (e.key === 'ArrowLeft') go(index - 1);
      else return;
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [index, go, onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  /** Keeps a zoomed picture from being dragged off screen. */
  const clamp = (z: Zoom): Zoom => {
    const el = img.current;
    const box = stage.current;
    if (!el || !box || z.s <= 1) return NO_ZOOM;
    const bx = Math.max(0, (el.offsetWidth * z.s - box.clientWidth) / 2);
    const by = Math.max(0, (el.offsetHeight * z.s - box.clientHeight) / 2);
    return { s: z.s, x: Math.min(bx, Math.max(-bx, z.x)), y: Math.min(by, Math.max(-by, z.y)) };
  };

  /** A screen point relative to the centre of the stage. */
  const local = (x: number, y: number) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: x - r.left - r.width / 2, y: y - r.top - r.height / 2 };
  };

  /** Zoom to scale s keeping the picture point under (px, py) still. */
  const zoomAt = (from: Zoom, s: number, p: { x: number; y: number }, at = p): Zoom =>
    clamp({ s, x: at.x - ((p.x - from.x) / from.s) * s, y: at.y - ((p.y - from.y) / from.s) * s });

  const pinchInfo = () => {
    const [a, b] = [...pointers.current.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: local((a.x + b.x) / 2, (a.y + b.y) / 2) };
  };

  const beginSingle = (x: number, y: number, mode: Mode) => {
    Object.assign(g.current, { mode, x0: x, y0: y, t0: Date.now(), zoom0: zoomRef.current });
  };

  const onDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setMoving(true);
    if (pointers.current.size === 2) {
      setDrag(0);
      setDrop(0);
      const { dist, mid } = pinchInfo();
      Object.assign(g.current, { mode: 'pinch', zoom0: zoomRef.current, dist0: dist, mid0: mid });
    } else if (pointers.current.size === 1) {
      beginSingle(e.clientX, e.clientY, 'pending');
    }
  };

  const onMove = (e: ReactPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const s = g.current;
    if (s.mode === 'pinch' && pointers.current.size >= 2) {
      const { dist, mid } = pinchInfo();
      const scale = Math.min(MAX_ZOOM, Math.max(1, (s.zoom0.s * dist) / s.dist0));
      setZoom(zoomAt(s.zoom0, scale, s.mid0, mid));
      return;
    }
    const dx = e.clientX - s.x0;
    const dy = e.clientY - s.y0;
    if (s.mode === 'pending' && Math.hypot(dx, dy) > 8) {
      if (zoomRef.current.s > 1) s.mode = 'pan';
      else if (Math.abs(dx) > Math.abs(dy)) s.mode = 'swipe';
      else s.mode = dy > 0 ? 'close' : 'ignore';
    }
    if (s.mode === 'pan') setZoom(clamp({ ...s.zoom0, x: s.zoom0.x + dx, y: s.zoom0.y + dy }));
    else if (s.mode === 'swipe') {
      const atEdge = (dx > 0 && index === 0) || (dx < 0 && index === count - 1);
      setDrag(atEdge ? dx / 3 : dx);
    } else if (s.mode === 'close') setDrop(Math.max(0, dy));
  };

  const onUp = (e: ReactPointerEvent) => {
    if (!pointers.current.delete(e.pointerId)) return;
    const s = g.current;
    const left = [...pointers.current.values()];
    if (s.mode === 'pinch') {
      if (zoomRef.current.s < 1.05) setZoom(NO_ZOOM);
      // One finger still down: carry on moving the zoomed picture with it.
      if (left.length === 1) beginSingle(left[0].x, left[0].y, 'pan');
      else s.mode = 'idle';
      if (!left.length) setMoving(false);
      return;
    }
    if (left.length) return;
    setMoving(false);
    const dx = e.clientX - s.x0;
    const dy = e.clientY - s.y0;
    const fast = Date.now() - s.t0 < 250;
    const width = stage.current?.clientWidth ?? window.innerWidth;
    if (s.mode === 'swipe') {
      if (dx < -width * 0.2 || (fast && dx < -40)) go(index + 1);
      else if (dx > width * 0.2 || (fast && dx > 40)) go(index - 1);
      setDrag(0);
    } else if (s.mode === 'close') {
      if (dy > 110 || (fast && dy > 50)) onClose();
      else setDrop(0);
    } else if (s.mode === 'pending' && e.type === 'pointerup') {
      // Double tap zooms in on that spot, or back out.
      const now = Date.now();
      const tap = s.lastTap;
      if (now - tap.t < 320 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 30) {
        const z = zoomRef.current;
        setZoom(z.s > 1 ? NO_ZOOM : zoomAt(z, DOUBLE_TAP_ZOOM, local(e.clientX, e.clientY)));
        s.lastTap = { t: 0, x: 0, y: 0 };
      } else s.lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
    s.mode = 'idle';
  };

  // Mouse wheel zooms on computers.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const z = zoomRef.current;
      const s = Math.min(MAX_ZOOM, Math.max(1, z.s * Math.exp(-e.deltaY * 0.002)));
      setZoom(s === 1 ? NO_ZOOM : zoomAt(z, s, local(e.clientX, e.clientY)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // zoomAt/local only read refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fade = Math.max(0.35, 1 - drop / 400);

  return createPortal(
    <div
      className="viewer"
      role="dialog"
      aria-modal="true"
      aria-label="Picture viewer"
      style={{ background: `rgba(6, 12, 26, ${fade})` }}
    >
      <div className="viewer-top" style={{ opacity: drop ? 0 : 1 }}>
        <span className="viewer-count">{count > 1 ? `${index + 1} / ${count}` : ''}</span>
        <button className="viewer-btn" onClick={onClose} aria-label="Close">
          <Icon icon={X} />
        </button>
      </div>
      <div
        ref={stage}
        className="viewer-stage"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div
          className="viewer-track"
          style={{
            transform: `translate3d(calc(${-index * 100}% + ${drag}px), ${drop}px, 0) scale(${1 - drop / 1500})`,
            transition: moving ? 'none' : 'transform 0.25s ease',
          }}
        >
          {images.map((src, i) => (
            <div className="viewer-slide" key={src + i}>
              {Math.abs(i - index) <= 1 && (
                <img
                  ref={i === index ? img : undefined}
                  src={src}
                  alt={`Picture ${i + 1} of ${count}`}
                  draggable={false}
                  decoding="async"
                  style={
                    i === index
                      ? {
                          transform: `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.s})`,
                          transition: moving ? 'none' : 'transform 0.2s ease',
                        }
                      : undefined
                  }
                />
              )}
            </div>
          ))}
        </div>
      </div>
      {index > 0 && (
        <button
          className="viewer-btn viewer-arrow prev"
          onClick={() => go(index - 1)}
          aria-label="Previous picture"
        >
          ‹
        </button>
      )}
      {index < count - 1 && (
        <button
          className="viewer-btn viewer-arrow next"
          onClick={() => go(index + 1)}
          aria-label="Next picture"
        >
          ›
        </button>
      )}
    </div>,
    document.body,
  );
}
