import imageCompression from 'browser-image-compression';
import { supabase } from './supabase';

export type UploadFolder = 'shops' | 'offers' | 'ads' | 'prizes' | 'support' | 'test';

/**
 * Compresses an image to WebP (max 1600 px) on the device, then sends it to the
 * app's /api/upload route, which stores it in R2. Returns the object key to store
 * in the database.
 */
export async function uploadImage(file: File, folder: UploadFolder): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Please sign in first');

  const webp = await imageCompression(file, {
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
