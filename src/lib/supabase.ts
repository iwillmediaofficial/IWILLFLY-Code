import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** For the few calls made without the client, e.g. reading which sign-in providers are on. */
export const supabaseUrl = url;
export const supabaseAnonKey = anonKey;

/**
 * The error Supabase puts in the address when a Google sign-in fails, read once at start-up before the
 * client looks at the address. Empty when there is none.
 */
export let oauthRedirectError = (() => {
  if (typeof window === 'undefined') return '';
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const error = query.get('error') ?? hash.get('error');
  if (!error) return '';
  return `${error} ${query.get('error_description') ?? hash.get('error_description') ?? ''}`.trim();
})();

/** Forgets the start-up sign-in error once it has been shown, and removes it from the address. */
export function clearOAuthRedirectError() {
  if (!oauthRedirectError) return;
  oauthRedirectError = '';
  window.history.replaceState(window.history.state, '', window.location.pathname);
}

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
