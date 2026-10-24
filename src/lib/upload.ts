import imageCompression from 'browser-image-compression';
import { supabase } from './supabase';

export type UploadFolder = 'shops' | 'offers' | 'ads' | 'prizes' | 'support' | 'categories' | 'test';

/** The upload route's limit for one image (worker/upload.ts), also checked here before sending. */
export const MAX_UPLOAD_BYTES = 1024 * 1024;

/** The largest picture that may be picked: bigger files can freeze or crash the tab while being shrunk. */
export const MAX_PICKED_BYTES = 10 * 1024 * 1024;

/** Refuses a picked picture over 10 MB, before any shrinking starts. */
export function checkPickedSize(file: Blob) {
  if (file.size > MAX_PICKED_BYTES)
    throw new Error('This picture is too large (max 10 MB). Please choose a smaller picture.');
}

/** How far one image has got: shrinking on the device ('preparing'), then sending it ('uploading'). */
export interface UploadProgress {
  stage: 'preparing' | 'uploading';
  /** 0 to 100 within the stage. */
  percent: number;
}

export type OnUploadProgress = (progress: UploadProgress) => void;

/** Offer pictures are saved at Instagram's portrait post size, so a vendor's 4:5 poster goes up unchanged. */
export const POSTER_WIDTH = 1080;
export const POSTER_HEIGHT = 1350;
export const POSTER_RATIO = POSTER_WIDTH / POSTER_HEIGHT;

/**
 * How a picture goes into the 4:5 poster frame: 'crop' takes this part of the picture (in its own pixels),
 * 'fit' keeps the whole picture and fills the space around it with a blurred copy.
 */
export type PosterFrame = ({ mode: 'crop' } & PosterCrop) | { mode: 'fit' };

/** A part of a picture, in its own pixels. */
export interface PosterCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UploadOptions {
  /** Centre-crop to a square of this many pixels (e.g. 512) instead of the usual max-1600 px resize. */
  square?: number;
  /** Make a 1080 x 1350 poster from this part of the picture instead of the usual max-1600 px resize. */
  poster?: PosterFrame;
  onProgress?: OnUploadProgress;
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
  checkPickedSize(file);
  if (!supabase) throw new Error('Supabase is not configured');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Please sign in first');

  const { onProgress } = options;
  onProgress?.({ stage: 'preparing', percent: 0 });
  const webp = options.poster
    ? await posterWebp(file, options.poster)
    : options.square
      ? await squareWebp(file, options.square)
      : await photoWebp(file, onProgress);
  return sendWebp(webp, folder, token, onProgress);
}

/**
 * The usual photo pipeline: WebP, at most 1600 px, about 400 KB (1 MB at most). Re-saving also drops hidden
 * photo data such as the GPS location.
 */
export async function photoWebp(file: File, onProgress?: OnUploadProgress): Promise<Blob> {
  const resized = await imageCompression(file, {
    maxWidthOrHeight: 1600,
    maxSizeMB: 0.4,
    fileType: 'image/webp',
    initialQuality: 0.8,
    // Its worker loads the library from a CDN, which the site's Content Security Policy blocks.
    useWebWorker: false,
    onProgress: (percent) => onProgress?.({ stage: 'preparing', percent }),
  });
  return asWebp(resized);
}

/** Reads a picked picture's pixels, turned the way the camera held it. */
export async function readBitmap(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This file could not be read as an image');
  }
}

/** True when a picture of this size is already 4:5, give or take 2%, so it needs no cropping. */
export function isPosterShaped(width: number, height: number) {
  return Math.abs(width / height / POSTER_RATIO - 1) <= 0.02;
}

/** The 4:5 frame centred on a picture, as large as it fits. */
export function centredPosterCrop(width: number, height: number): PosterCrop {
  const w = Math.min(width, height * POSTER_RATIO);
  const h = w / POSTER_RATIO;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

/** Draws the picture into a 1080 x 1350 WebP poster, cropped or fitted whole as `frame` says. */
export async function posterWebp(file: File, frame: PosterFrame): Promise<Blob> {
  const bitmap = await readBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = POSTER_WIDTH;
  canvas.height = POSTER_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image processing is not available in this browser');
  ctx.imageSmoothingQuality = 'high';
  if (frame.mode === 'crop') {
    ctx.drawImage(bitmap, frame.x, frame.y, frame.width, frame.height, 0, 0, POSTER_WIDTH, POSTER_HEIGHT);
  } else {
    // A blur that works in every browser (Safari has no canvas filter): shrink a cover-cropped copy to a few
    // pixels, then stretch it back over the frame, slightly darkened so the picture stands out.
    const cover = centredPosterCrop(bitmap.width, bitmap.height);
    const tiny = document.createElement('canvas');
    tiny.width = 16;
    tiny.height = 20;
    tiny.getContext('2d')?.drawImage(bitmap, cover.x, cover.y, cover.width, cover.height, 0, 0, 16, 20);
    ctx.drawImage(tiny, 0, 0, POSTER_WIDTH, POSTER_HEIGHT);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);
    const scale = Math.min(POSTER_WIDTH / bitmap.width, POSTER_HEIGHT / bitmap.height);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    ctx.drawImage(bitmap, (POSTER_WIDTH - w) / 2, (POSTER_HEIGHT - h) / 2, w, h);
  }
  bitmap.close();
  // Re-saving drops hidden photo data such as the GPS location; aim for about 400 KB like other photos.
  let blob: Blob | null = null;
  for (const quality of [0.85, 0.75, 0.6]) {
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
    if (!blob) throw new Error('This picture could not be prepared');
    if (blob.type !== 'image/webp' || blob.size <= 400 * 1024) break;
  }
  return asWebp(blob!);
}

/**
 * Safari, and so every browser on iPhone and iPad, cannot save a canvas as WebP: it hands back PNG, which the
 * upload route refuses. Such images are encoded to WebP here instead, with libwebp in WebAssembly (loaded only
 * when needed), at falling quality until the file is about 400 KB.
 */
async function asWebp(image: Blob): Promise<Blob> {
  if (await hasWebpBytes(image)) return image;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(image);
  } catch {
    throw new Error('This file could not be read as an image');
  }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image processing is not available in this browser');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { default: encode } = await import('@jsquash/webp/encode');
  let webp: ArrayBuffer | null = null;
  for (const quality of [80, 65, 50]) {
    webp = await encode(pixels, { quality });
    if (webp.byteLength <= 400 * 1024) break;
  }
  return new Blob([webp!], { type: 'image/webp' });
}

/** True when the file really is WebP (its first bytes, not the type the browser claims). */
async function hasWebpBytes(image: Blob) {
  const head = new Uint8Array(await image.slice(0, 12).arrayBuffer());
  const ascii = (from: number) => String.fromCharCode(...head.slice(from, from + 4));
  return head.length === 12 && ascii(0) === 'RIFF' && ascii(8) === 'WEBP';
}

/** The parsed body, or null when it is not JSON (e.g. an error page). */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Posts a WebP to /api/upload and returns the stored object's key. Uses XMLHttpRequest rather than fetch,
 * because only it reports how much of the body has been sent.
 */
export async function sendWebp(
  webp: Blob,
  folder: UploadFolder | 'bills' | 'payments',
  token: string,
  onProgress?: OnUploadProgress,
): Promise<string> {
  if (webp.size > MAX_UPLOAD_BYTES)
    throw new Error('This picture is over 1 MB even after shrinking. Please choose a smaller picture.');
  onProgress?.({ stage: 'uploading', percent: 0 });
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/upload?folder=${folder}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', 'image/webp');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress?.({ stage: 'uploading', percent: Math.round((e.loaded / e.total) * 100) });
    };
    xhr.onload = () => {
      const out = parseJson(xhr.responseText) as { key?: string; error?: string } | null;
      const ok = xhr.status >= 200 && xhr.status < 300;
      if (!ok || !out?.key) reject(new Error(out?.error || `Upload failed (${xhr.status})`));
      else resolve(out.key);
    };
    xhr.onerror = () =>
      reject(new Error('Upload failed. Please check your internet connection and try again.'));
    xhr.onabort = () => reject(new Error('Upload was cancelled'));
    xhr.send(webp);
  });
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
  if (!blob) throw new Error('Image processing is not available in this browser');
  // Browsers without WebP encoding (Safari) hand back PNG; the upload route only accepts WebP.
  return asWebp(blob);
}
