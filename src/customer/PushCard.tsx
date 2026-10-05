import { useEffect, useState } from 'react';
import { useToast } from '../components/Toast';
import { disablePush, enablePush, getPushState, type PushState } from '../lib/push';
import { errorText } from './util';

/** Lets the signed-in user turn push notifications on or off for this browser. */
export function PushCard() {
  const toast = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    getPushState().then(
      (s) => live && setState(s),
      () => live && setState('unsupported'),
    );
    return () => {
      live = false;
    };
  }, []);

  if (!state || state === 'not-configured') return null;

  const run = async (fn: () => Promise<PushState>) => {
    setBusy(true);
    try {
      const next = await fn();
      setState(next);
      if (next === 'on') toast('Notifications turned on');
      else if (next === 'off' && fn === disablePush) toast('Notifications turned off');
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="form-card">
      <h3 style={{ marginTop: 0 }}>🔔 Push notifications</h3>
      {state === 'unsupported' && (
        <p className="meta push-text">
          Your browser can’t receive notifications. On iPhone, add IWILLFLY to your Home Screen first (Share ›
          Add to Home Screen), then open it from there.
        </p>
      )}
      {state === 'denied' && (
        <p className="meta push-text">
          Notifications are blocked for IWILLFLY. To allow them, tap the lock or settings icon next to the
          address bar (or open your phone’s Settings › Notifications), allow notifications for this site, then
          come back to this page.
        </p>
      )}
      {state === 'off' && (
        <>
          <p className="meta push-text">
            Get festival offers, prize alerts and updates from shops you save, even when the app is closed.
          </p>
          <button className="btn block" disabled={busy} onClick={() => run(enablePush)}>
            {busy ? 'Turning on…' : 'Turn on notifications'}
          </button>
        </>
      )}
      {state === 'on' && (
        <>
          <p className="meta push-text">
            <b style={{ color: 'var(--color-green)' }}>✓ Notifications are on</b> for this device.
          </p>
          <button className="link-btn" disabled={busy} onClick={() => run(disablePush)}>
            {busy ? 'Turning off…' : 'Turn off notifications'}
          </button>
        </>
      )}
    </section>
  );
}
