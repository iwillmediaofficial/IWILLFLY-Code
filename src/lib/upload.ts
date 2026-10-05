import imageCompression from 'browser-image-compression';
import { supabase } from './supabase';

export type UploadFolder = 'shops' | 'offers' | 'ads' | 'prizes' | 'test';

/**
 * Compresses an image to WebP (max 1600 px) on the device, asks the upload-url
 * Worker route for a short-lived signed URL, then PUTs straight to R2.
 * Returns the object key to store in the database.
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

  const res = await fetch('/api/upload-url', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder, size: webp.size }),
  });
  if (!res.ok) throw new Error((await res.text()) || `Upload not allowed (${res.status})`);
  const { url, key, headers } = (await res.json()) as {
    url: string;
    key: string;
    headers: Record<string, string>;
  };

  const put = await fetch(url, { method: 'PUT', headers, body: webp });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  return key;
}
