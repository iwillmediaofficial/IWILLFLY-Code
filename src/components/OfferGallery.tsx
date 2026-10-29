import { useRef, useState } from 'react';
import { mediaUrl } from '../lib/supabase';
import { ImageViewer } from './ImageViewer';
import { useImageViewer } from './useImageViewer';
import { Maximize2 } from 'lucide-react';
import { Icon } from './Icon';

/** An offer's pictures shown whole, one at a time: swipe between them, tap one to see it full screen. */
export function OfferGallery({ imageKeys }: { imageKeys: string[] }) {
  const urls = imageKeys.map((k) => mediaUrl(k));
  const count = urls.length;
  const track = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  const viewer = useImageViewer();

  const scrollTo = (i: number) => {
    const el = track.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  };

  return (
    <div className="gallery-wrap">
      <div className="gallery">
        <div
          ref={track}
          className="gallery-track"
          onScroll={(e) => {
            const el = e.currentTarget;
            setCurrent(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
          }}
        >
          {urls.map((src, i) => (
            <button
              key={imageKeys[i]}
              type="button"
              className="gallery-slide"
              onClick={() => viewer.open(i)}
              aria-label={`View picture ${i + 1} of ${count} full screen`}
            >
              <img src={src} alt="" loading={i ? 'lazy' : undefined} decoding="async" />
            </button>
          ))}
        </div>
        {count > 1 && <span className="gallery-count">{`${current + 1} / ${count}`}</span>}
        <span className="gallery-hint">
          <Icon icon={Maximize2} /> Tap to enlarge
        </span>
        {count > 1 && current > 0 && (
          <button
            type="button"
            className="gallery-arrow prev"
            onClick={() => scrollTo(current - 1)}
            aria-label="Previous picture"
          >
            ‹
          </button>
        )}
        {count > 1 && current < count - 1 && (
          <button
            type="button"
            className="gallery-arrow next"
            onClick={() => scrollTo(current + 1)}
            aria-label="Next picture"
          >
            ›
          </button>
        )}
      </div>
      {count > 1 && (
        <div className="gallery-dots">
          {urls.map((src, i) => (
            <i key={src + i} className={`dot${i === current ? ' active' : ''}`} />
          ))}
        </div>
      )}
      {viewer.index != null && <ImageViewer images={urls} start={viewer.index} onClose={viewer.close} />}
    </div>
  );
}
