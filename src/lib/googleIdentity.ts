/**
 * Google's own sign-in button (Google Identity Services). Google's popup opens from this site, so Google
 * names IWILLFLY and its logo on it, not the Supabase address that the redirect sign-in goes through.
 * The ID token it returns is handed to Supabase with signInWithIdToken.
 */

/** The Google web client ID. Public (it is in every sign-in link). Unset = the redirect sign-in is used. */
export const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() || '';

export interface GoogleCredential {
  credential: string;
}

interface GoogleButtonOptions {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  logo_alignment?: 'left' | 'center';
  width?: number;
}

interface GoogleIdentity {
  initialize(options: {
    client_id: string;
    callback: (response: GoogleCredential) => void;
    nonce?: string;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    itp_support?: boolean;
    use_fedcm_for_button?: boolean;
  }): void;
  renderButton(parent: HTMLElement, options: GoogleButtonOptions): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdentity } };
  }
}

const SCRIPT = 'https://accounts.google.com/gsi/client';
let loading: Promise<GoogleIdentity> | null = null;

/** Loads Google's script once. Rejects when it is blocked or offline, so the caller can fall back. */
export function loadGoogleIdentity(): Promise<GoogleIdentity> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  loading ??= new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => {
      const id = window.google?.accounts?.id;
      if (id) resolve(id);
      else reject(new Error('Google sign-in did not load'));
    };
    script.onerror = () => reject(new Error('Google sign-in did not load'));
    document.head.appendChild(script);
  }).catch((e: unknown) => {
    loading = null;
    throw e;
  });
  return loading;
}

/**
 * A fresh nonce pair: Google puts the hashed one in the ID token, Supabase gets the raw one and checks
 * that they match, so a token cannot be replayed.
 */
export async function newNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const raw = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const hashed = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return { raw, hashed };
}
