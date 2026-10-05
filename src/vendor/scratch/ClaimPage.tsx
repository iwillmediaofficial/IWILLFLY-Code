import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import { formatCode } from '../../lib/scratch';
import { mediaUrl } from '../../lib/supabase';
import type { ClaimLookup } from '../../lib/types';
import { useVendor } from '../context';
import { errorMessage } from '../format';
import { BlockedNote, Lockable, PageHead } from '../ui';
import { useClaimPrize } from './api';
import { formatDateTime, parseClaimCode } from './format';
import QrScanner from './QrScanner';

type Found = Exclude<ClaimLookup, { status: 'not_found' }>;

export default function ClaimPage() {
  const vendor = useVendor();
  const toast = useToast();
  const claim = useClaimPrize();
  const locked = vendor.status === 'blocked';
  const [scanning, setScanning] = useState(false);
  const [cameraNote, setCameraNote] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ code: string; data: ClaimLookup } | null>(null);

  const lookup = (code: string) => {
    setError('');
    setResult(null);
    claim.mutate(
      { code, confirm: false },
      {
        onSuccess: (data) => setResult({ code, data }),
        onError: (e) => setError(errorMessage(e)),
      },
    );
  };

  const handOver = (code: string) => {
    setError('');
    claim.mutate(
      { code, confirm: true },
      {
        onSuccess: (data) => {
          setResult({ code, data });
          if (data.status === 'claimed_now') toast('Prize handed over');
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  };

  const onScan = (raw: string) => {
    setScanning(false);
    const code = parseClaimCode(raw);
    if (!code) {
      setResult(null);
      setError("This QR code isn't an IWILLFLY prize code. Ask the customer to open the prize in their app.");
      return;
    }
    setText(formatCode(code));
    lookup(code);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const code = parseClaimCode(text);
    if (!code) {
      setError('A claim code has 8 letters and numbers, like ABCD-2345.');
      return;
    }
    lookup(code);
  };

  const reset = () => {
    setResult(null);
    setText('');
    setError('');
    claim.reset();
  };

  const looking = claim.isPending && claim.variables?.confirm === false;
  const confirming = claim.isPending && claim.variables?.confirm === true;

  return (
    <>
      <PageHead title="Verify a prize" action={<Link to="/vendor/scratch">Scratch & Win</Link>} />
      {locked && <BlockedNote />}
      {vendor.status === 'pending' && (
        <div className="notice warn">
          Your business is still under review. You can hand over prizes once IWILLFLY approves your account.
        </div>
      )}
      <Lockable locked={locked}>
        {!result && (
          <>
            <p className="meta" style={{ fontSize: 13, marginTop: 0 }}>
              Ask the winner to open the prize in their IWILLFLY app, then scan its QR code or type the claim
              code.
            </p>
            {scanning ? (
              <div style={{ marginBottom: 12 }}>
                <QrScanner
                  onScan={onScan}
                  onUnavailable={(msg) => {
                    setScanning(false);
                    setCameraNote(msg);
                  }}
                />
                <button
                  type="button"
                  className="btn secondary block"
                  style={{ marginTop: 8 }}
                  onClick={() => setScanning(false)}
                >
                  Stop camera
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn block"
                style={{ padding: '18px 16px', fontSize: 16, marginBottom: 12 }}
                disabled={looking}
                onClick={() => {
                  setCameraNote('');
                  setError('');
                  setScanning(true);
                }}
              >
                📷 Scan customer's QR code
              </button>
            )}
            {cameraNote && <div className="notice warn">{cameraNote}</div>}
            <form className="form-card" onSubmit={submit} noValidate>
              <div className="field">
                <label htmlFor="claim-code">Or type the claim code</label>
                <input
                  id="claim-code"
                  value={text}
                  onChange={(e) => setText(e.target.value.toUpperCase())}
                  maxLength={20}
                  autoCapitalize="characters"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="ABCD-2345"
                  style={{
                    fontSize: 22,
                    letterSpacing: '0.12em',
                    textAlign: 'center',
                    fontWeight: 800,
                  }}
                />
              </div>
              {error && <p className="error-text">{error}</p>}
              <button className="btn block" type="submit" disabled={looking} style={{ marginTop: 8 }}>
                {looking ? 'Checking…' : 'Check code'}
              </button>
            </form>
          </>
        )}
        {result && (
          <>
            {result.data.status === 'not_found' ? (
              <NotFoundCard code={result.code} />
            ) : (
              <ResultCard
                code={result.code}
                found={result.data}
                confirming={confirming}
                onHandOver={() => handOver(result.code)}
              />
            )}
            {error && <p className="error-text">{error}</p>}
            <button
              type="button"
              className="btn secondary block"
              style={{ marginTop: 12 }}
              disabled={confirming}
              onClick={reset}
            >
              Verify another prize
            </button>
          </>
        )}
      </Lockable>
    </>
  );
}

function NotFoundCard({ code }: { code: string }) {
  return (
    <div className="notice bad">
      <b>No prize found for {formatCode(code)}.</b> Check the code with the customer. A code only works at the
      business that sponsors the prize, so it may belong to another shop.
    </div>
  );
}

function ResultCard({
  code,
  found: r,
  confirming,
  onHandOver,
}: {
  code: string;
  found: Found;
  confirming: boolean;
  onHandOver: () => void;
}) {
  const flagged = r.status === 'flagged' || (r.status === 'unclaimed' && r.fraud_flag);
  return (
    <>
      {r.status === 'claimed_now' && (
        <div className="notice" style={{ background: '#e8f8ef' }}>
          <b>✓ Prize handed over.</b> It is marked as claimed and can't be used again.
        </div>
      )}
      {r.status === 'claimed' && (
        <div className="notice bad">
          <b>Already handed over</b> on {formatDateTime(r.claimed_at)}. Don't give it again.
        </div>
      )}
      {r.status === 'expired' && (
        <div className="notice bad">
          <b>This prize has expired.</b> It had to be collected by {formatDateTime(r.expires_at)}.
        </div>
      )}
      {flagged && (
        <div className="notice bad">
          <b>This prize is on hold.</b> IWILLFLY is reviewing it for suspicious activity, so don't hand it
          over. Please contact the IWILLFLY team.
        </div>
      )}
      {r.status === 'unclaimed' && !flagged && (
        <div className="notice">
          <b>Valid prize.</b> Check the customer's app matches, then hand over the prize.
        </div>
      )}
      <div className="form-card">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div className="shop-thumb" style={{ width: 74, flex: 'none', overflow: 'hidden' }}>
            {r.prize?.image_key ? (
              <img
                src={mediaUrl(r.prize.image_key)}
                alt=""
                loading="lazy"
                decoding="async"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              '🎁'
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 17 }}>{r.prize?.name ?? 'Prize'}</h3>
            <div className="meta">{r.campaign_name}</div>
          </div>
        </div>
        {r.prize?.description && <p style={{ fontSize: 13, margin: '10px 0 0' }}>{r.prize.description}</p>}
        <div className="info-grid" style={{ marginTop: 12 }}>
          <Info label="Customer" value={r.customer_name} />
          <Info label="Claim code" value={formatCode(r.claim_code ?? code)} />
          <Info label="Won on" value={formatDateTime(r.played_at)} />
          {r.status === 'claimed' || r.status === 'claimed_now' ? (
            <Info label="Handed over" value={formatDateTime(r.claimed_at)} />
          ) : (
            <Info
              label={r.status === 'expired' ? 'Expired' : 'Valid until'}
              value={formatDateTime(r.expires_at)}
            />
          )}
        </div>
        {r.status === 'unclaimed' && !flagged && (
          <button
            type="button"
            className="btn block"
            style={{ marginTop: 14, padding: '16px', fontSize: 16 }}
            disabled={confirming}
            onClick={onHandOver}
          >
            {confirming ? 'Saving…' : 'Hand over prize'}
          </button>
        )}
      </div>
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-card" style={{ padding: 10 }}>
      <span>{label}</span>
      <strong style={{ fontSize: 14, overflowWrap: 'anywhere' }}>{value}</strong>
    </div>
  );
}
