import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { closedLabel, formatDay, useCampaignPrizes, type ScratchCard } from '../customer/scratch';
import { errorText } from '../customer/util';
import { useProfileArea } from '../lib/profileArea';
import { formatCode, formatTime } from '../lib/scratch';
import { mediaUrl } from '../lib/supabase';
import type { PlayResult, TodayCampaign } from '../lib/types';
import { ScratchLocationSheet } from './ScratchLocation';
import { SponsorContact } from './SponsorContact';
import { useToast } from './Toast';

/**
 * The daily button: green = play now, red = played today, gray = nothing to play right now.
 * Signed-in customers must set their area first (from their phone's location or by picking it); the button
 * asks for it and opens the card as soon as it is saved.
 */
export function ScratchButton({ card, style }: { card: ScratchCard; style?: CSSProperties }) {
  const toast = useToast();
  const { session } = useAuth();
  const { areaId, known } = useProfileArea();
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const c = card.campaign;

  // Saving the area re-reads today's campaigns for it first, so the cache already says whether it can be
  // played there; if so, open the card straight away.
  const afterSave = (areaName: string) => {
    setAsking(false);
    if (!c) return;
    const fresh =
      qc
        .getQueryData<TodayCampaign[]>(['scratch_today', session?.user.id ?? null])
        ?.find((x) => x.id === c.id) ?? c;
    if (!fresh.eligible)
      toast(`This Scratch & Win isn’t running in ${areaName}. Check back for games in your area.`);
    else if (fresh.is_open_now && !card.result) card.setOpen(true);
  };

  return (
    <>
      <ScratchButtonFace
        card={card}
        style={style}
        needsArea={Boolean(session) && known && areaId == null}
        onAskArea={() => setAsking(true)}
      />
      <ScratchLocationSheet
        open={asking}
        onClose={() => setAsking(false)}
        onSaved={(area) => afterSave(area.name)}
      />
    </>
  );
}

type Tone = 'green' | 'gray' | 'red';

type Face = {
  tone: Tone;
  top: ReactNode;
  title?: string;
  sub: ReactNode;
  onClick: () => void;
};

function ScratchButtonFace({
  card,
  style,
  needsArea,
  onAskArea,
}: {
  card: ScratchCard;
  style?: CSSProperties;
  needsArea: boolean;
  onAskArea: () => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const { session } = useAuth();
  const c = card.campaign;
  const play = card.result;

  let face: Face;
  let live = false;
  if (!c) {
    face = {
      tone: 'gray',
      top: card.loading ? 'LOADING' : 'NO GAME TODAY',
      sub: card.loading ? 'Checking today’s game…' : 'Check back soon',
      onClick: () => !card.loading && toast('No Scratch & Win is running today. Check back soon.'),
    };
  } else if (play) {
    face = {
      tone: 'red',
      top: play.won ? '✓ WON TODAY' : '✓ PLAYED TODAY',
      title: play.won ? 'CLAIM' : 'PLAYED',
      sub: (
        <>
          {play.won ? (play.prize?.name ?? 'Prize won') : 'Better luck tomorrow'}
          <br />
          Come back tomorrow
        </>
      ),
      onClick: () => card.setOpen(true),
    };
  } else if (needsArea) {
    face = {
      tone: c.is_open_now ? 'green' : 'gray',
      top: '📍 SET YOUR LOCATION',
      sub: (
        <>
          Tap to set your area
          <br />
          and play today’s card
        </>
      ),
      onClick: onAskArea,
    };
  } else if (session && !c.eligible) {
    face = {
      tone: 'gray',
      top: 'NOT IN YOUR AREA',
      sub: (
        <>
          This game is for another area
          <br />
          Tap to change your area
        </>
      ),
      onClick: onAskArea,
    };
  } else if (!c.is_open_now) {
    const hours = `${formatTime(c.active_from)} – ${formatTime(c.active_to)}`;
    const label = closedLabel(c);
    face = {
      tone: 'gray',
      top: 'CLOSED NOW',
      sub: (
        <>
          {label}
          <br />
          Available {hours}
        </>
      ),
      onClick: () => toast(`Scratch & Win is available ${hours}. ${label}.`),
    };
  } else {
    live = true;
    face = {
      tone: 'green',
      top: `LIVE · TILL ${formatTime(c.active_to)}`,
      sub: 'One chance today',
      onClick: () => {
        if (!session) {
          toast('Sign in to play Scratch & Win');
          navigate('/login');
          return;
        }
        card.setOpen(true);
      },
    };
  }

  return <ScratchStage face={face} live={live} won={Boolean(play?.won)} style={style} />;
}

type Burst = { id: number; dots: { x: number; y: number; color: string }[] };

/** The round 3D button with its glow, coins, sparkles and gift box around it. */
function ScratchStage({
  face,
  live,
  won,
  style,
}: {
  face: Face;
  live: boolean;
  won: boolean;
  style?: CSSProperties;
}) {
  const [pressed, setPressed] = useState(false);
  const [burst, setBurst] = useState<Burst | null>(null);
  const release = () => setPressed(false);

  // A ring of sparkles flying out from the button when it is tapped.
  const sparkle = () => {
    const dots = Array.from({ length: 14 }, (_, i) => {
      const a = (i / 14) * Math.PI * 2;
      const d = 95 + Math.random() * 25;
      return {
        x: Math.cos(a) * d,
        y: Math.sin(a) * d,
        color: i % 3 ? '#ffdc16' : i % 2 ? '#ffffff' : '#ff8a21',
      };
    });
    setBurst({ id: Date.now(), dots });
  };

  return (
    <div className={`sw-stage sw-${face.tone}${live ? '' : ' compact'}`} style={style}>
      <div className="sw-halo" />
      <StageDecor />
      <button
        className={`sw-btn${pressed ? ' pressed' : ''}`}
        onPointerDown={() => setPressed(true)}
        onPointerUp={release}
        onPointerLeave={release}
        onPointerCancel={release}
        onClick={() => {
          if (live || won) sparkle();
          face.onClick();
        }}
      >
        <span className="sw-ring" />
        <span className="sw-face">
          {live && (
            <span className="sw-star" aria-hidden>
              ★
            </span>
          )}
          <span className="sw-live">
            {live && <span className="sw-dot" />}
            <span>{face.top}</span>
          </span>
          <span className="sw-title">
            {face.title ?? (
              <>
                SCRATCH
                <br />
                <span className="sw-amp">&amp;</span> WIN
              </>
            )}
          </span>
          <span className="sw-sub">{face.sub}</span>
          {live && (
            <svg className="sw-mini-gift" viewBox="0 0 24 24" aria-hidden>
              <rect x="4" y="10" width="16" height="11" rx="1.5" fill="#ffdc16" />
              <rect x="3" y="7" width="18" height="4" rx="1" fill="#ffe866" />
              <rect x="11" y="7" width="2" height="14" fill="#ef3b43" />
              <path d="M12 7c-2-4-6-4-6-2s4 2 6 2Zm0 0c2-4 6-4 6-2s-4 2-6 2Z" fill="#ef3b43" />
            </svg>
          )}
        </span>
        {burst && (
          <span key={burst.id} className="sw-burst" aria-hidden>
            {burst.dots.map((d, i) => (
              <i
                key={i}
                style={{ '--x': `${d.x}px`, '--y': `${d.y}px`, background: d.color } as CSSProperties}
              />
            ))}
          </span>
        )}
      </button>
    </div>
  );
}

const SPARKS = [
  ['s1', '#ffc928'],
  ['s2', '#ffd84d'],
  ['s3', '#ffc928'],
  ['s4', '#ffe27a'],
  ['s5', '#ffc928'],
];

function Coin({ className, rupee = true }: { className: string; rupee?: boolean }) {
  return (
    <svg className={`sw-deco sw-coin ${className}`} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="11" fill="#e3a10b" />
      <circle cx="12" cy="11" r="10" fill="#ffcf33" />
      <circle cx="12" cy="11" r="7" fill="none" stroke="#e8a90f" strokeWidth="1.5" />
      {rupee && (
        <text x="12" y="15" textAnchor="middle" fontSize="10" fontWeight="900" fill="#c98a00">
          ₹
        </text>
      )}
    </svg>
  );
}

/** Sparkles, confetti, coins and the gift box around the button. */
function StageDecor() {
  return (
    <div aria-hidden>
      {SPARKS.map(([k, fill]) => (
        <svg key={k} className={`sw-deco sw-spark ${k}`} viewBox="0 0 20 20">
          <path d="M10 0 12 8 20 10 12 12 10 20 8 12 0 10 8 8Z" fill={fill} />
        </svg>
      ))}
      <span className="sw-deco sw-confetti k1" />
      <span className="sw-deco sw-confetti k2" />
      <span className="sw-deco sw-confetti k3" />
      <Coin className="c1" />
      <Coin className="c2" />
      <Coin className="c3" rupee={false} />
      <svg className="sw-deco sw-gift" viewBox="0 0 80 80">
        <ellipse cx="40" cy="76" rx="26" ry="3.5" fill="rgba(23,36,63,.15)" />
        <path d="M14 36h52v36a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4Z" fill="#ffc21a" />
        <path d="M40 36h26v36a4 4 0 0 1-4 4H40Z" fill="#f2a900" />
        <rect x="10" y="27" width="60" height="12" rx="3" fill="#ffd54a" />
        <rect x="40" y="27" width="30" height="12" rx="3" fill="#ffbf1f" />
        <rect x="35" y="27" width="10" height="49" fill="#ef3b43" />
        <rect x="40" y="27" width="5" height="49" fill="#c9232b" />
        <path d="M40 27c-6-12-20-14-20-6 0 6 12 7 20 6Z" fill="#ef3b43" />
        <path d="M40 27c6-12 20-14 20-6 0 6-12 7-20 6Z" fill="#d22a32" />
        <circle cx="40" cy="26" r="4" fill="#ff5a61" />
        <rect x="17" y="40" width="4" height="22" rx="2" fill="rgba(255,255,255,.45)" />
      </svg>
    </div>
  );
}

export function ScratchModal({
  card,
  title,
  subtitle,
  children,
}: {
  card: ScratchCard;
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  const { open, setOpen, result, revealed } = card;

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <div
      className={`modal${open ? ' show' : ''}`}
      onClick={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div className="sheet">
        <div className="sheet-head">
          <div>
            <h2 style={{ margin: 0 }}>{title}</h2>
            <div className="meta">{revealed ? (card.campaign?.name ?? subtitle) : subtitle}</div>
          </div>
          <button className="close" onClick={() => setOpen(false)} aria-label="Close">
            ×
          </button>
        </div>
        {revealed ? (
          <div className="scratch-area revealed">
            <div className="result">
              <ResultFace result={result} />
            </div>
          </div>
        ) : open ? (
          <ScratchSurface key={card.attempt} card={card} />
        ) : (
          <div className="scratch-area" />
        )}
        {card.error && !revealed && <div className="notice bad">{errorText(card.error)}</div>}
        {revealed && result ? <ResultScreen result={result} onClose={() => setOpen(false)} /> : children}
      </div>
    </div>
  );
}

/** What shows under the silver layer. */
function ResultFace({ result }: { result: PlayResult | null }) {
  if (!result) {
    return (
      <>
        <div style={{ fontSize: 42 }}>⏳</div>
        <h2 style={{ margin: '7px 0' }}>Checking…</h2>
        <p style={{ margin: 0, color: 'var(--color-muted)', fontSize: 12 }}>Getting today’s result</p>
      </>
    );
  }
  if (!result.won) {
    return (
      <>
        <div style={{ fontSize: 42 }}>🍀</div>
        <h2 style={{ margin: '7px 0' }}>Better Luck Tomorrow</h2>
        <p style={{ margin: 0, color: 'var(--color-muted)', fontSize: 12 }}>
          No prize this time. Try again tomorrow.
        </p>
      </>
    );
  }
  return (
    <>
      <div style={{ fontSize: 42 }}>🎉</div>
      <h2 style={{ margin: '7px 0' }}>{result.prize?.name ?? 'You won!'}</h2>
      <p style={{ margin: 0, color: 'var(--color-muted)', fontSize: 12 }}>
        Show your claim code at {result.sponsor?.name ?? 'the shop'} to claim.
      </p>
    </>
  );
}

/** Details under the card once the result is revealed. */
function ResultScreen({ result, onClose }: { result: PlayResult; onClose: () => void }) {
  if (!result.won) {
    return (
      <div className="form-card" style={{ textAlign: 'center' }}>
        <h3 style={{ margin: '0 0 6px' }}>Better luck tomorrow</h3>
        <div className="meta" style={{ marginBottom: 12 }}>
          You get one free scratch every day. Come back tomorrow for another chance.
        </div>
        <button className="btn secondary block" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }
  return (
    <div className="form-card win-card">
      {result.prize?.image_key ? (
        <img
          className="win-img"
          src={mediaUrl(result.prize.image_key)}
          alt=""
          decoding="async"
          width={96}
          height={96}
        />
      ) : (
        <div className="win-icon">🎁</div>
      )}
      <h3 style={{ margin: '0 0 4px' }}>{result.prize?.name}</h3>
      {result.prize?.description && <div className="meta">{result.prize.description}</div>}
      {result.sponsor && <div className="meta">Sponsored by {result.sponsor.name}</div>}
      {result.claim_code && <div className="claim-code">{formatCode(result.claim_code)}</div>}
      <div className="meta" style={{ marginBottom: 12 }}>
        {result.sponsor
          ? `Show this code at ${result.sponsor.name}${
              result.sponsor.collect_at?.length ? ` (${result.sponsor.collect_at.join(', ')})` : ''
            }. `
          : ''}
        {result.expires_at && `Valid till ${formatDay(result.expires_at)}`}
      </div>
      <Link className="btn block" to="/prizes" style={{ display: 'block', textAlign: 'center' }}>
        View in My Prizes
      </Link>
      <SponsorContact result={result} />
    </div>
  );
}

const BRUSH = 38;

/**
 * The silver layer, drawn on a canvas so it can be scratched off. Touching it starts the play on the
 * server; a tap or scratching about half of it reveals the result underneath.
 */
function ScratchSurface({ card }: { card: ScratchCard }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; moved: number } | null>(null);
  const touched = useRef(false);
  const [started, setStarted] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const cv = canvas.current;
    const el = wrap.current;
    if (!cv || !el) return;
    const paint = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(width * dpr);
      cv.height = Math.round(height * dpr);
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      // Same stripes as the prototype's repeating-linear-gradient(45deg, #d4d6db 0 10px, #c1c4ca 10px 20px).
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#d4d6db';
      ctx.fillRect(0, 0, width, height);
      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.rotate(Math.PI / 4);
      const d = Math.hypot(width, height);
      ctx.fillStyle = '#c1c4ca';
      for (let y = -d; y < d; y += 20) ctx.fillRect(-d, y + 10, 2 * d, 10);
      ctx.restore();
    };
    paint();
    const ro = new ResizeObserver(() => !touched.current && paint());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const point = (e: PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const erase = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = BRUSH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x + 0.01, b.y);
    ctx.stroke();
  };

  const cleared = () => {
    const cv = canvas.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx || !cv.width || !cv.height) return 1;
    const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let clear = 0;
    let total = 0;
    for (let i = 3; i < data.length; i += 4 * 24) {
      total++;
      if (data[i] === 0) clear++;
    }
    return total ? clear / total : 1;
  };

  const begin = () => {
    if (!touched.current) {
      touched.current = true;
      setStarted(true);
      card.start();
    }
  };

  const finish = () => {
    setGone(true);
    card.reveal();
  };

  return (
    <div ref={wrap} className="scratch-area scratching">
      <div className="result">
        <ResultFace result={card.result} />
      </div>
      <canvas
        ref={canvas}
        className={`scratch-canvas${gone ? ' gone' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="Scratch to reveal today’s prize"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            begin();
            finish();
          }
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = point(e);
          drag.current = { ...p, moved: 0 };
          begin();
          erase(p, p);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const p = point(e);
          erase(d, p);
          drag.current = { ...p, moved: d.moved + Math.hypot(p.x - d.x, p.y - d.y) };
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (!d) return;
          if (d.moved < 10 || cleared() > 0.45) finish();
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      />
      <div className={`cover${started ? ' gone' : ''}`}>
        <div style={{ fontSize: 36 }}>☝️</div>
        <h2>SCRATCH HERE</h2>
        <div className="meta">Scratch or tap to reveal today’s prize</div>
      </div>
    </div>
  );
}

export type PrizeItem = { key: string | number; label: string; icon?: string; imageKey?: string | null };

export function PrizeGrid({ items }: { items: PrizeItem[] }) {
  return (
    <div className="prize-grid">
      {items.map((p) => (
        <div key={p.key} className="prize">
          {p.imageKey ? (
            <img src={mediaUrl(p.imageKey)} alt="" loading="lazy" decoding="async" width={36} height={36} />
          ) : (
            <b>{p.icon ?? '🎁'}</b>
          )}
          {p.label}
        </div>
      ))}
    </div>
  );
}

/** A campaign's live prizes as a PrizeGrid. */
export function CampaignPrizes({ campaignId, limit }: { campaignId: number | undefined; limit?: number }) {
  const { data, isLoading, error } = useCampaignPrizes(campaignId);
  if (!campaignId) return <div className="meta">Prizes will appear here when a game is running.</div>;
  if (isLoading) return <div className="meta">Loading prizes…</div>;
  if (error) return <div className="notice bad">{errorText(error)}</div>;
  const list = (data ?? []).filter((p) => p.remaining > 0);
  if (!list.length) return <div className="meta">Prizes will be announced soon.</div>;
  return (
    <PrizeGrid
      items={list.slice(0, limit).map((p) => ({ key: p.id, label: p.name, imageKey: p.image_key }))}
    />
  );
}
