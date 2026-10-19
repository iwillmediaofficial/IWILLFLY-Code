import { useCallback, useEffect, useState } from 'react';

/**
 * Opens the full-screen viewer at a picture and closes it again. Opening adds a history entry,
 * so the phone's back button closes the viewer instead of leaving the page.
 */
export function useImageViewer() {
  const [index, setIndex] = useState<number | null>(null);
  useEffect(() => {
    const onPop = () => setIndex(null);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const open = useCallback((i: number) => {
    window.history.pushState({ ...window.history.state, imageViewer: true }, '');
    setIndex(i);
  }, []);
  const close = useCallback(() => {
    if (window.history.state?.imageViewer) window.history.back();
    else setIndex(null);
  }, []);
  return { index, open, close };
}
