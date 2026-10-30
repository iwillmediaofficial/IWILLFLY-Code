import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { pointsText, rupees } from '../lib/points';
import type { PointsWallet } from '../lib/types';

const R = 47;
const C = 2 * Math.PI * R;
const RUN_MS = 1300;

const n = (v: number) => v.toLocaleString('en-IN');
const reduceMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Counts from 0 up to the target once, easing out. */
function useCountUp(target: number) {
  const [shown, setShown] = useState(() => (reduceMotion() ? target : 0));
  useEffect(() => {
    const ms = reduceMotion() ? 0 : RUN_MS;
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = ms ? Math.min((now - t0) / ms, 1) : 1;
      setShown(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown;
}

/**
 * Profile card: points ring filling towards the cash-out minimum, with the
 * points still being checked, and Add a bill / Cash out. All numbers come
 * from the points settings via the wallet.
 */
export function PointsRing({ w }: { w: PointsWallet }) {
  const navigate = useNavigate();
  const goal = Math.max(w.min_redeem_points, 1);
  const step = Math.max(w.redeem_step_points, 1);
  const hold = w.on_hold ?? 0;
  const reached = w.balance >= goal;
  const cashable = reached ? Math.floor(w.balance / step) * step : 0;
  // one open cash-out at a time: while one is waiting, keep nudging bills instead
  const canCashOut = reached && hold === 0;

  const shown = useCountUp(w.balance);
  const frac = Math.min(shown / goal, 1);
  const dotAngle = frac * 2 * Math.PI;
  const pendStart = Math.min(w.balance / goal, 1);
  const pendLen = reached ? 0 : Math.min(w.pending_points / goal, 1 - pendStart);
  const done = shown >= w.balance;

  let line: ReactNode;
  if (w.balance === 0 && hold === 0) {
    line = (
      <>
        Every {rupees(w.rupees_per_point)} on a bill
        <br />= 1 point = {rupees(w.point_value)}
      </>
    );
  } else if (reached) {
    const next = cashable + step;
    line = `${n(next - w.balance)} more for ${rupees(next * w.point_value)}`;
  } else {
    line = `${n(goal - w.balance)} more to cash out`;
  }

  return (
    <div className={`points-ring${reached ? ' full' : ''}`}>
      <button
        type="button"
        className="points-ring-dial"
        onClick={() => navigate('/points')}
        aria-label={`${pointsText(w.balance)}. Open My Points`}
      >
        <svg viewBox="0 0 112 112" aria-hidden="true">
          <defs>
            <linearGradient id="points-ring-gold" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#fff07a" />
              <stop offset=".6" stopColor="#ffdc16" />
              <stop offset="1" stopColor="#ffb800" />
            </linearGradient>
          </defs>
          <circle className="track" cx="56" cy="56" r={R} />
          {pendLen > 0 && (
            <circle
              className="pend"
              cx="56"
              cy="56"
              r={R}
              strokeDasharray={`${C * pendLen} ${C}`}
              strokeDashoffset={-C * pendStart}
            />
          )}
          {frac > 0 && (
            <circle
              className="prog"
              cx="56"
              cy="56"
              r={R}
              strokeDasharray={`${C} ${C}`}
              strokeDashoffset={C * (1 - frac)}
            />
          )}
          {frac > 0.01 && frac < 1 && (
            <circle className="tip" cx={56 + R * Math.cos(dotAngle)} cy={56 + R * Math.sin(dotAngle)} r="3" />
          )}
        </svg>
        <span className="points-ring-in">
          <span className="coin">₹</span>
          <b style={w.balance >= 1000 ? { fontSize: 20 } : undefined}>{n(Math.round(shown))}</b>
          {reached ? (
            <small className="ready">{rupees(cashable * w.point_value)} ready</small>
          ) : (
            <small>of {n(goal)} pts</small>
          )}
        </span>
        {reached && done && !reduceMotion() && (
          <span className="points-ring-sparks" aria-hidden="true">
            {Array.from({ length: 14 }, (_, i) => {
              const a = (i / 14) * 2 * Math.PI;
              const d = 58 + (i % 3) * 8;
              return (
                <i
                  key={i}
                  style={
                    {
                      '--x': `${Math.cos(a) * d}px`,
                      '--y': `${Math.sin(a) * d}px`,
                    } as CSSProperties
                  }
                />
              );
            })}
          </span>
        )}
      </button>
      <div className="points-ring-line">{line}</div>
      {hold > 0 ? (
        <div className="points-ring-chip">
          <i />
          {rupees(hold * w.point_value)} on its way
        </div>
      ) : (
        w.pending_points > 0 &&
        !reached && (
          <div className="points-ring-chip">
            <i />+{n(w.pending_points)} being checked
          </div>
        )
      )}
      {canCashOut ? (
        <Link className="points-ring-btn cash" to="/points/redeem">
          Cash out {rupees(cashable * w.point_value)}
        </Link>
      ) : (
        <Link className="points-ring-btn" to="/points/add">
          ＋ {w.balance === 0 && hold === 0 ? 'Add first bill' : 'Add a bill'}
        </Link>
      )}
    </div>
  );
}
