import { useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { adExternalUrl, resolveAdPath, useAds } from '../customer/engagement';
import { mediaUrl } from '../lib/supabase';
import type { Ad } from '../lib/types';

interface Slide {
  key: string;
  cls: string;
  pill: string | null;
  lines: string[];
  text: string | null;
  imageKey?: string | null;
  ad?: Ad;
}

/** The prototype slides, shown when no ads are running or the backend is not connected. */
const fallback: Slide[] = [
  {
    key: 'f1',
    cls: 'ad1',
    pill: 'MAIN FESTIVAL OFFER',
    lines: ['Celebrate Local.', 'Save More.'],
    text: 'Big festive offers from your favourite stores.',
  },
  {
    key: 'f2',
    cls: 'ad2',
    pill: 'MALL DAYS',
    lines: ['One mall.', 'Many offers.'],
    text: 'Browse stores inside leading malls.',
  },
  {
    key: 'f3',
    cls: 'ad3',
    pill: 'MEGA TEXTILE WEEK',
    lines: ['Style Deals', 'Near You.'],
    text: 'Special offers from Kerala’s popular textile stores.',
  },
];

const STYLES = ['ad1', 'ad2', 'ad3'];

const isLinked = (ad: Ad | undefined) => Boolean(ad && ad.link_kind !== 'none' && ad.link_target);

function slideStyle(s: Slide): CSSProperties | undefined {
  if (!s.imageKey && !isLinked(s.ad)) return undefined;
  return {
    ...(s.imageKey && {
      backgroundImage: `linear-gradient(180deg, rgba(0, 0, 0, 0.12), rgba(0, 0, 0, 0.68)), url(${mediaUrl(s.imageKey)})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    }),
    ...(isLinked(s.ad) && { cursor: 'pointer' }),
  };
}

export function AdSlider() {
  const { data } = useAds();
  const navigate = useNavigate();
  const slides: Slide[] = data?.length
    ? data.map((a) => ({
        key: `ad${a.id}`,
        cls: STYLES.includes(a.style) ? a.style : 'ad1',
        pill: a.pill,
        lines: a.title.split('\n'),
        text: a.subtitle,
        imageKey: a.image_key,
        ad: a,
      }))
    : fallback;
  const count = slides.length;
  const [i, setI] = useState(0);
  const index = i % count;

  useEffect(() => {
    if (count < 2) return;
    const t = window.setInterval(() => setI((x) => (x + 1) % count), 3500);
    return () => window.clearInterval(t);
  }, [count]);

  const open = (ad: Ad) => {
    if (ad.link_kind === 'url') {
      // Opened straight from the tap so pop-up blockers allow it.
      const url = adExternalUrl(ad);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    resolveAdPath(ad).then(
      (path) => path && navigate(path),
      () => undefined,
    );
  };

  return (
    <section className="ad-slider">
      <div className="ad-track" style={{ transform: `translateX(-${index * 100}%)` }}>
        {slides.map((s) => {
          const ad = isLinked(s.ad) ? s.ad : undefined;
          return (
            <div
              key={s.key}
              className={`ad ${s.cls}`}
              style={slideStyle(s)}
              role={ad ? 'link' : undefined}
              tabIndex={ad ? 0 : undefined}
              onClick={ad ? () => open(ad) : undefined}
              onKeyDown={ad ? (e) => e.key === 'Enter' && open(ad) : undefined}
            >
              {s.pill && <span className="pill">{s.pill}</span>}
              <h3>
                {s.lines.map((line, n) => (
                  <span key={n}>
                    {n > 0 && <br />}
                    {line}
                  </span>
                ))}
              </h3>
              {s.text && <p>{s.text}</p>}
            </div>
          );
        })}
      </div>
      {count > 1 && (
        <div className="dots">
          {slides.map((s, x) => (
            <i key={s.key} className={`dot${x === index ? ' active' : ''}`} />
          ))}
        </div>
      )}
    </section>
  );
}
