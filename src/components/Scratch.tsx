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

  if (!c) {
    return (
      <button
        className="scratch-btn gray"
        style={style}
        onClick={() => !card.loading && toast('No Scratch & Win is running today. Check back soon.')}
      >
        <div style={{ fontSize: 13, fontWeight: 800 }}>{card.loading ? 'LOADING' : 'NO GAME TODAY'}</div>
        <div className="big">
          SCRATCH
          <br />& WIN
        </div>
        <small>{card.loading ? 'Checking today’s game…' : 'Check back soon'}</small>
      </button>
    );
  }
  if (play) {
    return (
      <button className="scratch-btn red" style={style} onClick={() => card.setOpen(true)}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>{play.won ? '✓ WON TODAY' : '✓ PLAYED TODAY'}</div>
        <div className="big">{play.won ? 'CLAIM' : 'PLAYED'}</div>
        <small>
          {play.won ? (play.prize?.name ?? 'Prize won') : 'Better luck tomorrow'}
          <br />
          Come back tomorrow
        </small>
      </button>
    );
  }
  if (needsArea) {
    return (
      <button className={`scratch-btn ${c.is_open_now ? 'green' : 'gray'}`} style={style} onClick={onAskArea}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>📍 SET YOUR LOCATION</div>
        <div className="big">
          SCRATCH
          <br />& WIN
        </div>
        <small>
          Tap to set your area
          <br />
          and play today’s card
        </small>
      </button>
    );
  }
  if (session && !c.eligible) {
    return (
      <button className="scratch-btn gray" style={style} onClick={onAskArea}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>NOT IN YOUR AREA</div>
        <div className="big">
          SCRATCH
          <br />& WIN
        </div>
        <small>
          This game is for another area
          <br />
          Tap to change your area
        </small>
      </button>
    );
  }
  const hours = `${formatTime(c.active_from)} – ${formatTime(c.active_to)}`;
  if (!c.is_open_now) {
    const label = closedLabel(c);
    return (
      <button
        className="scratch-btn gray"
        style={style}
        onClick={() => toast(`Scratch & Win is available ${hours}. ${label}.`)}
      >
        <div style={{ fontSize: 13, fontWeight: 800 }}>CLOSED NOW</div>
        <div className="big">
          SCRATCH
          <br />& WIN
        </div>
        <small>
          {label}
          <br />
          Available {hours}
        </small>
      </button>
    );
  }
  return (
    <button
      className="scratch-btn green"
      style={style}
      onClick={() => {
        if (!session) {
          toast('Sign in to play Scratch & Win');
          navigate('/login');
          return;
        }
        card.setOpen(true);
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 800 }}>● LIVE · TILL {formatTime(c.active_to)}</div>
      <div className="big">
        SCRATCH
        <br />& WIN
      </div>
      <small>One chance today</small>
    </button>
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
        {result.sponsor ? `Show this code at ${result.sponsor.name}. ` : ''}
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
