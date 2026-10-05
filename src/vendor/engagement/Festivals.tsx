import { Link } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import { mediaUrl } from '../../lib/supabase';
import type { Festival, FestivalOfferRow, Offer, Shop } from '../../lib/types';
import { useReadOnly, useVendor } from '../context';
import { errorMessage, formatDate, offerPhase, phaseClass, phaseLabel, todayIST } from '../format';
import { BlockedNote, ErrorNote, Loading, Lockable, PageHead } from '../ui';
import { useFestivalData, useFestivalSubmission } from './api';
import { festivalOpen, reviewClass, reviewLabel, submissionsCloseOn } from './format';

export default function VendorFestivals() {
  const vendor = useVendor();
  const readOnly = useReadOnly();
  const { festivals, offers, shops, submissions, isPending, error } = useFestivalData();
  const today = todayIST();
  const open = (festivals ?? []).filter((f) => festivalOpen(f, today));
  const closed = (festivals ?? []).filter((f) => !festivalOpen(f, today));
  const props = { offers: offers ?? [], shops: shops ?? [], submissions: submissions ?? [] };

  return (
    <>
      <PageHead title="Festivals" />
      {readOnly ? (
        <BlockedNote />
      ) : vendor.status === 'pending' ? (
        <div className="notice warn">
          <b>Your business is under review.</b> You can submit offers now; customers see them on festival
          pages once IWILLFLY approves your account.
        </div>
      ) : (
        <div className="notice">
          Put your offers on IWILLFLY festival pages. Submit an offer and the IWILLFLY team reviews it. Only
          approved offers that are live appear on the festival page.
        </div>
      )}
      {isPending ? (
        <Loading />
      ) : error ? (
        <ErrorNote error={error} />
      ) : open.length + closed.length === 0 ? (
        <div className="saved-empty">
          <div className="emoji">🎉</div>
          <h3>No festivals right now</h3>
          <p>When IWILLFLY opens a festival, it shows up here and you can submit your offers.</p>
        </div>
      ) : (
        <Lockable locked={readOnly}>
          {open.length > 0 && (
            <section className="section" style={{ marginTop: 0 }}>
              <div className="section-head">
                <h2>Open for submissions</h2>
              </div>
              <div className="list">
                {open.map((f) => (
                  <FestivalCard key={f.id} festival={f} isOpen {...props} />
                ))}
              </div>
            </section>
          )}
          {closed.length > 0 && (
            <section className="section">
              <div className="section-head">
                <h2>Submissions closed</h2>
              </div>
              <div className="list">
                {closed.map((f) => (
                  <FestivalCard key={f.id} festival={f} isOpen={false} {...props} />
                ))}
              </div>
            </section>
          )}
        </Lockable>
      )}
    </>
  );
}

function FestivalCard({
  festival: f,
  isOpen,
  offers,
  shops,
  submissions,
}: {
  festival: Festival;
  isOpen: boolean;
  offers: Offer[];
  shops: Shop[];
  submissions: FestivalOfferRow[];
}) {
  const mine = new Map(submissions.filter((s) => s.festival_id === f.id).map((s) => [s.offer_id, s]));
  // Open festivals list every offer that could still go in; closed ones only what was submitted.
  const shown = offers.filter((o) => {
    if (mine.has(o.id)) return true;
    if (!isOpen) return false;
    const phase = offerPhase(o);
    return phase !== 'rejected' && phase !== 'ended';
  });
  const shopName = (id: number) => shops.find((s) => s.id === id)?.name ?? '';

  return (
    <div className="manage-card" style={{ marginTop: 0 }}>
      {f.banner_key ? (
        <img
          src={mediaUrl(f.banner_key)}
          alt=""
          loading="lazy"
          decoding="async"
          style={{
            width: '100%',
            aspectRatio: '16 / 6',
            objectFit: 'cover',
            borderRadius: 14,
            display: 'block',
            marginBottom: 10,
          }}
        />
      ) : (
        <div
          aria-hidden="true"
          style={{
            height: 10,
            borderRadius: 99,
            background: f.theme_color ?? 'var(--color-blue)',
            marginBottom: 10,
          }}
        />
      )}
      <h4>{f.name}</h4>
      <div className="meta">
        {formatDate(f.starts_on)} – {formatDate(f.ends_on)}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
        <span className={`pill-status ${isOpen ? 'live' : ''}`}>
          {isOpen ? `Submissions close ${formatDate(submissionsCloseOn(f))}` : 'Submissions closed'}
        </span>
        {mine.size > 0 && (
          <span className="pill-status approved">
            {mine.size} {mine.size === 1 ? 'offer' : 'offers'} submitted
          </span>
        )}
      </div>
      {f.description && <p style={{ fontSize: 13, margin: '8px 0 0', lineHeight: 1.5 }}>{f.description}</p>}

      <div style={{ borderTop: '1px solid var(--color-line)', marginTop: 12, paddingTop: 10 }}>
        <div className="meta" style={{ fontWeight: 800, marginBottom: 6 }}>
          Your offers
        </div>
        {shown.length === 0 ? (
          isOpen ? (
            <p className="meta" style={{ fontSize: 13, margin: 0 }}>
              You have no offers to submit.{' '}
              <Link to="/vendor/offers/new" style={{ color: 'var(--color-blue)', fontWeight: 800 }}>
                Post an offer
              </Link>
            </p>
          ) : (
            <p className="meta" style={{ fontSize: 13, margin: 0 }}>
              You didn't submit offers to this festival.
            </p>
          )
        ) : (
          shown.map((o) => (
            <OfferLine
              key={o.id}
              festival={f}
              offer={o}
              shopName={shopName(o.shop_id)}
              submission={mine.get(o.id) ?? null}
              isOpen={isOpen}
            />
          ))
        )}
      </div>
    </div>
  );
}

function OfferLine({
  festival,
  offer: o,
  shopName,
  submission: s,
  isOpen,
}: {
  festival: Festival;
  offer: Offer;
  shopName: string;
  submission: FestivalOfferRow | null;
  isOpen: boolean;
}) {
  const toast = useToast();
  const change = useFestivalSubmission();
  const phase = offerPhase(o);
  const run = (submit: boolean) =>
    change.mutate(
      { festivalId: festival.id, offerId: o.id, submit },
      {
        onSuccess: () =>
          toast(submit ? `Sent to IWILLFLY for ${festival.name}` : `Withdrawn from ${festival.name}`),
        onError: (e) => toast(errorMessage(e)),
      },
    );
  const withdraw = () => {
    const note = s?.status === 'approved' ? ' It comes off the festival page.' : '';
    if (confirm(`Withdraw "${o.title}" from ${festival.name}?${note}`)) run(false);
  };

  return (
    <div style={{ padding: '8px 0', borderTop: '1px dashed var(--color-line)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'start', justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>{o.title}</div>
          <div className="meta">
            {shopName}
            {o.discount_label && ` · ${o.discount_label}`}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            {s && <span className={`pill-status ${reviewClass[s.status]}`}>{reviewLabel[s.status]}</span>}
            {phase !== 'live' && (
              <span className={`pill-status ${phaseClass[phase]}`}>Offer: {phaseLabel[phase]}</span>
            )}
          </div>
        </div>
        {isOpen && (
          <div style={{ flex: 'none' }}>
            {s ? (
              <button
                type="button"
                className="btn danger small"
                disabled={change.isPending}
                onClick={withdraw}
              >
                {change.isPending ? 'Withdrawing…' : 'Withdraw'}
              </button>
            ) : (
              <button
                type="button"
                className="btn small"
                disabled={change.isPending}
                onClick={() => run(true)}
              >
                {change.isPending ? 'Sending…' : 'Submit'}
              </button>
            )}
          </div>
        )}
      </div>
      {s?.note && (
        <p className={s.status === 'rejected' ? 'error-text' : 'meta'} style={{ marginTop: 4 }}>
          Note from IWILLFLY: {s.note}
        </p>
      )}
      {phase !== 'live' && s?.status !== 'rejected' && (
        <p className="meta" style={{ fontSize: 11, margin: '4px 0 0' }}>
          {visibilityNote(phase, o)}
        </p>
      )}
    </div>
  );
}

/** Why an offer that isn't live won't show on the festival page yet. */
function visibilityNote(phase: ReturnType<typeof offerPhase>, o: Offer) {
  switch (phase) {
    case 'pending':
      return 'Only approved, live offers appear on the festival page. This one shows once IWILLFLY approves the offer itself.';
    case 'paused':
      return 'Only live offers appear on the festival page. This one is paused, so it stays hidden until you resume it.';
    case 'scheduled':
      return `Only live offers appear on the festival page. This one shows from ${formatDate(o.starts_on)}.`;
    case 'ended':
      return 'This offer has ended, so it no longer appears on the festival page.';
    case 'rejected':
      return 'This offer was rejected, so it cannot appear on the festival page.';
    default:
      return '';
  }
}
