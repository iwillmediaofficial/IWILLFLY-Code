import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { POSTER_RATIO, type PosterFrame } from '../lib/upload';

export interface PendingCrop {
  url: string;
  width: number;
  height: number;
  title: string;
  resolve: (frame: PosterFrame | null) => void;
}

/** The crop screen: drag and zoom a 4:5 frame over the picture, or keep the whole picture. */
export function PosterCropSheet({
  pending,
  onDone,
}: {
  pending: PendingCrop;
  onDone: (frame: PosterFrame | null) => void;
}) {
  const { url, width, height, title } = pending;
  const [mode, setMode] = useState<'crop' | 'fit'>('crop');
  const [zoom, setZoom] = useState(1);
  const [centre, setCentre] = useState({ x: width / 2, y: height / 2 });
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  // The crop's size in the picture's own pixels: the largest 4:5 part at zoom 1, smaller as it zooms in.
  const cropWidth = Math.min(width, height * POSTER_RATIO) / zoom;
  const cropHeight = cropWidth / POSTER_RATIO;
  const clamp = (c: { x: number; y: number }) => ({
    x: Math.min(Math.max(c.x, cropWidth / 2), width - cropWidth / 2),
    y: Math.min(Math.max(c.y, cropHeight / 2), height - cropHeight / 2),
  });
  const at = clamp(centre);

  // Locks page scroll while open, like the app's other sheets; Escape cancels.
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onDone(null);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = before;
      window.removeEventListener('keydown', onKey);
    };
  }, [onDone]);

  const onPointerDown = (e: PointerEvent) => {
    if (mode !== 'crop') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!drag.current || !frame.current) return;
    // Screen pixels to picture pixels: the frame's width shows cropWidth picture pixels.
    const scale = cropWidth / frame.current.clientWidth;
    const dx = (e.clientX - drag.current.x) * scale;
    const dy = (e.clientY - drag.current.y) * scale;
    drag.current = { x: e.clientX, y: e.clientY };
    setCentre((c) => clamp({ x: clamp(c).x - dx, y: clamp(c).y - dy }));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const use = () =>
    onDone(
      mode === 'fit'
        ? { mode: 'fit' }
        : {
            mode: 'crop',
            x: at.x - cropWidth / 2,
            y: at.y - cropHeight / 2,
            width: cropWidth,
            height: cropHeight,
          },
    );

  return createPortal(
    <div className="modal show" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet poster-crop">
        <div className="sheet-head">
          <h3 style={{ margin: 0 }}>{title}</h3>
        </div>
        <p className="meta" style={{ margin: '4px 0 10px' }}>
          Offer pictures are 4:5 (1080 × 1350, Instagram post size).
          {mode === 'crop' ? ' Drag to move, use the slider to zoom.' : ' The whole picture is kept.'}
        </p>
        <div className="poster-crop-modes" role="group" aria-label="How to fit the picture">
          <button type="button" className={mode === 'crop' ? 'active' : ''} onClick={() => setMode('crop')}>
            Crop to fill
          </button>
          <button type="button" className={mode === 'fit' ? 'active' : ''} onClick={() => setMode('fit')}>
            Fit whole picture
          </button>
        </div>
        <div
          ref={frame}
          className={`poster-crop-frame${mode === 'crop' ? ' draggable' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {mode === 'crop' ? (
            <img
              src={url}
              alt=""
              draggable={false}
              style={{
                position: 'absolute',
                width: `${(width / cropWidth) * 100}%`,
                left: `${(-(at.x - cropWidth / 2) / cropWidth) * 100}%`,
                top: `${(-(at.y - cropHeight / 2) / cropHeight) * 100}%`,
                maxWidth: 'none',
              }}
            />
          ) : (
            <>
              <img src={url} alt="" draggable={false} className="poster-crop-blur" />
              <img src={url} alt="" draggable={false} className="poster-crop-whole" />
            </>
          )}
        </div>
        {mode === 'crop' && (
          <div className="poster-crop-zoom">
            <label htmlFor="poster-zoom">Zoom</label>
            <input
              id="poster-zoom"
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button type="button" className="btn secondary" style={{ flex: 1 }} onClick={() => onDone(null)}>
            Cancel
          </button>
          <button type="button" className="btn" style={{ flex: 1 }} onClick={use}>
            Use picture
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
