import imageCompression from 'browser-image-compression';
import { supabase } from './supabase';

export type UploadFolder = 'shops' | 'offers' | 'ads' | 'prizes' | 'support' | 'categories' | 'test';

export interface UploadOptions {
  /** Centre-crop to a square of this many pixels (e.g. 512) instead of the usual max-1600 px resize. */
  square?: number;
}

/**
 * Compresses an image to WebP on the device (max 1600 px, or a centre-cropped square with `square`), then
 * sends it to the app's /api/upload route, which stores it in R2. Returns the object key to store in the
 * database.
 */
export async function uploadImage(
  file: File,
  folder: UploadFolder,
  options: UploadOptions = {},
): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Please sign in first');

  const webp = options.square
    ? await squareWebp(file, options.square)
    : await imageCompression(file, {
        maxWidthOrHeight: 1600,
        maxSizeMB: 0.4,
        fileType: 'image/webp',
        initialQuality: 0.8,
        useWebWorker: true,
      });

  const res = await fetch(`/api/upload?folder=${folder}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/webp' },
    body: webp,
  });
  const out = (await res.json().catch(() => null)) as { key?: string; error?: string } | null;
  if (!res.ok || !out?.key) throw new Error(out?.error || `Upload failed (${res.status})`);
  return out.key;
}

/** The largest centred square of the image, scaled to size x size, as WebP. Phone photos are turned upright. */
export async function squareWebp(file: Blob, size: number): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This file could not be read as an image');
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image processing is not available in this browser');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
  // Browsers without WebP encoding hand back PNG; the upload route only accepts WebP.
  if (!blob || blob.type !== 'image/webp') throw new Error('This browser cannot create WebP images');
  return blob;
}
