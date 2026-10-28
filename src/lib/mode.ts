import { useCallback } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../components/Toast';

/** Which side of IWILLFLY a vendor login is using: their shop dashboard or the customer app. */
export type AppMode = 'vendor' | 'customer';

const KEY = 'iwillfly.mode';

/** The mode last picked with the switch on this device, or null if it was never used. */
export function savedMode(): AppMode | null {
  try {
    const m = localStorage.getItem(KEY);
    return m === 'vendor' || m === 'customer' ? m : null;
  } catch {
    return null;
  }
}

function saveMode(m: AppMode) {
  try {
    localStorage.setItem(KEY, m);
  } catch {
    // private window or blocked storage: the switch still works, it just isn't remembered
  }
}

const MESSAGE: Record<AppMode, string> = {
  vendor: 'Vendor view: back to your shop',
  customer: 'Customer view: you see IWILLFLY like your shoppers',
};

/** How long the pill's knob slides before the screen changes. */
const KNOB_MS = 260;

/**
 * Opens the other side of the app. The new screen grows in a circle out of the switch (View Transitions),
 * or simply appears where the browser can't animate it or the person asked for less motion.
 */
export function useSwitchMode() {
  const navigate = useNavigate();
  const toast = useToast();
  return useCallback(
    (to: AppMode, from: HTMLElement) => {
      saveMode(to);
      try {
        navigator.vibrate?.(12);
      } catch {
        // not allowed here
      }
      const go = () => navigate(to === 'vendor' ? '/vendor' : '/');
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.setTimeout(() => {
        if (reduce || !document.startViewTransition) {
          go();
          toast(MESSAGE[to]);
          return;
        }
        const r = from.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
        const t = document.startViewTransition(() => flushSync(go));
        t.ready
          .then(() => {
            const root = document.documentElement;
            root.animate(
              { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
              {
                duration: 560,
                easing: 'cubic-bezier(.65,0,.35,1)',
                pseudoElement: '::view-transition-new(root)',
              },
            );
            root.animate(
              { transform: ['none', 'scale(.94)'], filter: ['none', 'brightness(.8)'] },
              { duration: 560, easing: 'ease', pseudoElement: '::view-transition-old(root)' },
            );
          })
          .catch(() => {});
        t.finished.finally(() => toast(MESSAGE[to]));
      }, KNOB_MS);
    },
    [navigate, toast],
  );
}
