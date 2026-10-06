import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { AppShell, LogoHeader } from '../../components/AppShell';
import { EmptyState } from '../../components/ShopCard';
import { SponsorContact } from '../../components/SponsorContact';
import { formatCode, useMyPrizes } from '../../lib/scratch';
import { supabase } from '../../lib/supabase';
import type { ClaimStatus, PlayResult } from '../../lib/types';
import { formatDay } from '../scratch';
import { ErrorNotice, Loading, NoBackend, Sheet, Thumb } from '../ui';

const TABS: { key: ClaimStatus; label: string }[] = [
  { key: 'unclaimed', label: 'Unclaimed' },
  { key: 'claimed', label: 'Claimed' },
  { key: 'expired', label: 'Expired' },
];

/** The server already reports past-expiry prizes as expired; this also covers a page left open. */
function statusOf(p: PlayResult): ClaimStatus {
  if (p.claim_status === 'unclaimed' && p.expires_at && new Date(p.expires_at) < new Date()) return 'expired';
  return p.claim_status ?? 'unclaimed';
}

export default function Prizes() {
  const { session, loading } = useAuth();
  return (
    <AppShell
      header={
        <LogoHeader
          actions={
            <Link className="icon-btn" to="/scratch" aria-label="Scratch & Win">
              🎁
            </Link>
          }
        />
      }
    >
      <section className="hero">
        <h1>My Prizes 🏆</h1>
        <p>Your Scratch & Win prizes. Show the claim code at the sponsor shop before it expires.</p>
      </section>
      <section className="section">
        {!supabase ? (
          <NoBackend />
        ) : loading ? (
          <Loading />
        ) : !session ? (
          <EmptyState
            emoji="🎁"
            title="Sign in to see your prizes"
            text="Play Scratch & Win every day and your prizes will appear here."
          >
            <Link className="btn" to="/login" style={{ display: 'inline-block', marginTop: 12 }}>
              Sign in
            </Link>
          </EmptyState>
        ) : (
          <PrizeList />
        )}
      </section>
    </AppShell>
  );
}

function PrizeList() {
  const { data, isLoading, error, refetch } = useMyPrizes();
  const [tab, setTab] = useState<ClaimStatus>('unclaimed');
  const [claiming, setClaiming] = useState<PlayResult | null>(null);

  if (isLoading) return <Loading text="Loading your prizes…" />;
  if (error) return <ErrorNotice error={error} onRetry={() => refetch()} />;

  const all = data ?? [];
  const shown = all.filter((p) => statusOf(p) === tab);

  return (
    <>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? 'active' : ''}
            onClick={() => setTab(t.key)}
          >
            {t.label} ({all.filter((p) => statusOf(p) === t.key).length})
          </button>
        ))}
      </div>
      {shown.length ? (
        <div className="list">
          {shown.map((p) => (
            <PrizeCard
              key={p.play_id}
              prize={p}
              onOpen={tab === 'unclaimed' ? () => setClaiming(p) : undefined}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          emoji={tab === 'unclaimed' ? '🎁' : tab === 'claimed' ? '✅' : '⌛'}
          title={
            tab === 'unclaimed'
              ? 'No prizes to claim'
              : tab === 'claimed'
                ? 'Nothing claimed yet'
                : 'No expired prizes'
          }
          text={
            tab === 'unclaimed'
              ? 'Scratch once every day for a chance to win prizes from local shops.'
              : tab === 'claimed'
                ? 'Prizes you collect from shops will show here.'
                : 'Prizes not claimed before their expiry date show here.'
          }
        >
          {tab === 'unclaimed' && (
            <Link className="btn" to="/scratch" style={{ display: 'inline-block', marginTop: 12 }}>
              Go to Scratch & Win
            </Link>
          )}
        </EmptyState>
      )}
      <Sheet
        open={claiming != null}
        onClose={() => setClaiming(null)}
        title={claiming?.prize?.name ?? 'Your prize'}
        subtitle={claiming?.campaign_name}
      >
        {claiming && <ClaimView prize={claiming} />}
      </Sheet>
    </>
  );
}

function PrizeCard({ prize: p, onOpen }: { prize: PlayResult; onOpen?: () => void }) {
  const status = statusOf(p);
  const dates =
    status === 'claimed'
      ? `Won ${formatDay(p.played_at)} · Claimed ${formatDay(p.claimed_at)}`
      : status === 'expired'
        ? `Won ${formatDay(p.played_at)} · Expired ${formatDay(p.expires_at)}`
        : `Won ${formatDay(p.played_at)} · Valid till ${formatDay(p.expires_at)}`;
  const body = (
    <>
      <Thumb imageKey={p.prize?.image_key} icon="🎁" />
      <div>
        <h4>{p.prize?.name ?? 'Prize'}</h4>
        <div className="meta">{[p.campaign_name, p.sponsor?.name].filter(Boolean).join(' · ')}</div>
        <div className="meta">{dates}</div>
        <span className={`prize-status ${status}`}>
          {status === 'unclaimed' ? 'Tap to claim' : status === 'claimed' ? 'Claimed' : 'Expired'}
        </span>
      </div>
      <div className="chev">{onOpen ? '›' : ''}</div>
    </>
  );
  if (!onOpen) {
    return (
      <div className="shop-card" style={{ cursor: 'default' }}>
        {body}
      </div>
    );
  }
  return (
    <button
      className="shop-card"
      onClick={onOpen}
      style={{ width: '100%', textAlign: 'left', font: 'inherit', color: 'inherit' }}
    >
      {body}
    </button>
  );
}

function ClaimView({ prize: p }: { prize: PlayResult }) {
  const shop = p.sponsor?.name ?? 'the participating shop';
  return (
    <div style={{ textAlign: 'center' }}>
      {p.claim_code ? (
        <>
          <ClaimQr key={p.claim_code} code={p.claim_code} />
          <div className="claim-code huge">{formatCode(p.claim_code)}</div>
        </>
      ) : (
        <div className="notice warn">This prize has no claim code. Please contact support.</div>
      )}
      <h3 style={{ margin: '6px 0 4px' }}>Show this at {shop}</h3>
      <div className="meta">
        {p.prize?.description ? `${p.prize.description} · ` : ''}
        Valid till {formatDay(p.expires_at)}
      </div>
      <div className="meta" style={{ marginTop: 8 }}>
        The shop scans the QR code or types the code to hand over your prize.
      </div>
      <SponsorContact result={p} />
    </div>
  );
}

function ClaimQr({ code }: { code: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    import('qrcode')
      .then((mod) => {
        const qr = (mod as unknown as { default?: typeof mod }).default ?? mod;
        return qr.toDataURL(code, { width: 560, margin: 1, errorCorrectionLevel: 'M' });
      })
      .then((url) => live && setSrc(url))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [code]);
  if (failed) return null;
  return src ? (
    <img
      className="claim-qr"
      src={src}
      width={280}
      height={280}
      decoding="async"
      alt={`QR code for claim code ${formatCode(code)}`}
    />
  ) : (
    <div className="claim-qr" style={{ display: 'grid', placeItems: 'center' }}>
      <span className="meta">Loading QR…</span>
    </div>
  );
}
