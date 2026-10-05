import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Null until VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set, so the UI still runs without a backend. */
export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, { auth: { persistSession: true, detectSessionInUrl: true } })
    : null;

export const mediaBaseUrl =
  (import.meta.env.VITE_MEDIA_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export function mediaUrl(key: string) {
  return `${mediaBaseUrl}/${key}`;
}
