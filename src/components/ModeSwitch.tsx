import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useSwitchMode, type AppMode } from '../lib/mode';

/**
 * The Vendor | Customer pill for vendor logins (owners, staff and branch managers). Tapping it slides the
 * knob across, then opens the other side of the app. Shows nothing for other accounts.
 */
export function ModeSwitch({ mode }: { mode: AppMode }) {
  const { roles } = useAuth();
  const switchMode = useSwitchMode();
  // The knob moves at once; the page changes after it has slid across.
  const [shown, setShown] = useState(mode);
  if (!roles.includes('vendor')) return null;

  return (
    <button
      type="button"
      className="mode-pill"
      data-mode={shown}
      role="switch"
      aria-checked={shown === 'customer'}
      aria-label="Customer view"
      onClick={(e) => {
        if (shown !== mode) return;
        const to = mode === 'vendor' ? 'customer' : 'vendor';
        setShown(to);
        switchMode(to, e.currentTarget);
      }}
    >
      <span className="thumb" aria-hidden="true" />
      <span className="seg v">Vendor</span>
      <span className="seg c">Customer</span>
    </button>
  );
}
