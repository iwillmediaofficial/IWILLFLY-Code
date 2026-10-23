import { useEffect } from 'react';

// Until the first page has shown, the loader carries on straight from the one index.html painted.
let pageShown = false;

/**
 * Full-screen IWILLFLY logo loader, the same one index.html paints on first load (its styles live there).
 * After the first page it fades in after a moment, so quick page switches don't flash it.
 */
export function PageLoader() {
  const delayed = pageShown;
  useEffect(
    () => () => {
      pageShown = true;
    },
    [],
  );
  return (
    <div
      className={delayed ? 'iwf-loader iwf-loader--delayed' : 'iwf-loader'}
      role="status"
      aria-label="Loading IWILLFLY"
    >
      <img className="iwf-loader-logo" src="/iwillfly-logo.webp" alt="" width={200} height={65} />
      <div className="iwf-loader-bar">
        <span />
      </div>
    </div>
  );
}
