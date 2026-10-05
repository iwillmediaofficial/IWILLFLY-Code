import { useEffect, useState, type CSSProperties } from 'react';
import { prizes } from '../data/demo';
import { readJSON, writeJSON } from '../lib/storage';
import { useToast } from './Toast';

// Phase 0 keeps the prototype's on-device demo. Phase 2 moves this to the play_scratch() database function.
const KEY = 'iwillfly-win';
type Play = { date: string; prize: string };

function today() {
  return new Date().toISOString().slice(0, 10);
}

function readPlay(): Play | null {
  const p = readJSON<Play | null>(KEY, null);
  return p && p.date === today() ? p : null;
}

function isActiveHours(d = new Date()) {
  const n = d.getHours() * 60 + d.getMinutes();
  return n >= 9 * 60 && n < 22 * 60;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDailyScratch() {
  const [play, setPlay] = useState<Play | null>(readPlay);
  const [open, setOpen] = useState(false);
  const reveal = () => {
    const p = { date: today(), prize: prizes[Math.floor(Math.random() * prizes.length)] };
    writeJSON(KEY, p);
    setPlay(p);
  };
  return { play, open, setOpen, reveal, active: isActiveHours() };
}

type Daily = ReturnType<typeof useDailyScratch>;

export function ScratchButton({ daily, style }: { daily: Daily; style?: CSSProperties }) {
  const toast = useToast();
  if (daily.play) {
    return (
      <button
        className="scratch-btn red"
        style={style}
        onClick={() => toast("Today's chance already used. Come back tomorrow.")}
      >
        <div style={{ fontSize: 13, fontWeight: 800 }}>✓ WON TODAY</div>
        <div className="big">{daily.play.prize === 'Better Luck Tomorrow' ? 'PLAYED' : 'CLAIM'}</div>
        <small>
          {daily.play.prize}
          <br />
          Come back tomorrow
        </small>
      </button>
    );
  }
  if (daily.active) {
    return (
      <button className="scratch-btn green" style={style} onClick={() => daily.setOpen(true)}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>● LIVE · 24 HRS</div>
        <div className="big">
          SCRATCH
          <br />& WIN
        </div>
        <small>One chance today</small>
      </button>
    );
  }
  return (
    <button
      className="scratch-btn gray"
      style={style}
      onClick={() => toast('Scratch & Win is available during shop hours.')}
    >
      <div style={{ fontSize: 13, fontWeight: 800 }}>CLOSED NOW</div>
      <div className="big">
        SCRATCH
        <br />& WIN
      </div>
      <small>Available 9:00 AM – 10:00 PM</small>
    </button>
  );
}

export function ScratchModal({
  daily,
  title,
  subtitle,
  children,
}: {
  daily: Daily;
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}) {
  const toast = useToast();
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    document.body.style.overflow = daily.open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [daily.open]);

  const onScratch = () => {
    if (revealed || daily.play) return;
    daily.reveal();
    setRevealed(true);
    toast("Today's result saved on this device.");
  };

  return (
    <div
      className={`modal${daily.open ? ' show' : ''}`}
      onClick={(e) => e.target === e.currentTarget && daily.setOpen(false)}
    >
      <div className="sheet">
        <div className="sheet-head">
          <div>
            <h2 style={{ margin: 0 }}>{title}</h2>
            <div className="meta">{subtitle}</div>
          </div>
          <button className="close" onClick={() => daily.setOpen(false)} aria-label="Close">
            ×
          </button>
        </div>
        <div className={`scratch-area${revealed ? ' revealed' : ''}`} onClick={onScratch}>
          <div className="cover">
            <div style={{ fontSize: 36 }}>☝️</div>
            <h2>SCRATCH HERE</h2>
            <div className="meta">Tap to reveal today’s prize</div>
          </div>
          <div className="result">
            <div style={{ fontSize: 42 }}>🎉</div>
            <h2 style={{ margin: '7px 0' }}>{daily.play?.prize}</h2>
            <p style={{ margin: 0, color: '#6f7c91', fontSize: 12 }}>
              Show this screen at the selected shop to claim.
            </p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

export function PrizeGrid({ items }: { items: [string, string][] }) {
  return (
    <div className="prize-grid">
      {items.map(([icon, label]) => (
        <div key={label} className="prize">
          <b>{icon}</b>
          {label}
        </div>
      ))}
    </div>
  );
}
