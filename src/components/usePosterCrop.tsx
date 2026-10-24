import { useCallback, useState } from 'react';
import { centredPosterCrop, isPosterShaped, type PosterFrame } from '../lib/upload';
import { PosterCropSheet, type PendingCrop } from './PosterCrop';

/** The picture's natural size, read through an <img>, which turns it the way the camera held it. */
function naturalSize(url: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('This file could not be read as an image'));
    img.src = url;
  });
}

/**
 * Fits picked pictures into the 4:5 offer poster frame. `ask(file)` answers at once for a picture that is
 * already 4:5; otherwise it opens a crop screen and answers with the vendor's choice, or null on Cancel.
 */
export function usePosterCrop() {
  const [pending, setPending] = useState<PendingCrop | null>(null);

  const ask = useCallback(async (file: File, title = 'Fit picture to 4:5'): Promise<PosterFrame | null> => {
    const url = URL.createObjectURL(file);
    try {
      const { width, height } = await naturalSize(url);
      if (isPosterShaped(width, height)) {
        URL.revokeObjectURL(url);
        return { mode: 'crop', ...centredPosterCrop(width, height) };
      }
      return await new Promise<PosterFrame | null>((resolve) =>
        setPending({ url, width, height, title, resolve }),
      );
    } catch (err) {
      URL.revokeObjectURL(url);
      throw err;
    }
  }, []);

  const finish = (frame: PosterFrame | null) => {
    if (!pending) return;
    URL.revokeObjectURL(pending.url);
    pending.resolve(frame);
    setPending(null);
  };

  const element = pending ? <PosterCropSheet key={pending.url} pending={pending} onDone={finish} /> : null;
  return { ask, element };
}
