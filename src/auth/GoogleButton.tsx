import { useEffect, useState, type CSSProperties } from 'react';
import {
  clearOAuthRedirectError,
  oauthRedirectError,
  supabase,
  supabaseAnonKey,
  supabaseUrl,
} from '../lib/supabase';
import { useAuth } from './AuthProvider';

const OFF = 'Google sign-in is not available right now. Please use your email and password instead.';

/** Turns what Supabase or Google sends back into words a customer can act on. */
function friendly(message: string) {
  const m = message.toLowerCase();
  if (m.includes('provider is not enabled') || m.includes('unsupported provider')) return OFF;
  if (m.includes('access_denied') || m.includes('cancel'))
    return 'Google sign-in was cancelled. Please try again.';
  if (m.includes('network') || m.includes('fetch'))
    return 'No connection. Check your internet and try again.';
  return 'Google sign-in did not work. Please try again, or use your email and password.';
}

/** Is Google switched on in Supabase? Unknown (true) if the check itself fails. */
async function googleEnabled() {
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: supabaseAnonKey ?? '' },
    });
    if (!res.ok) return true;
    const settings = (await res.json()) as { external?: { google?: boolean } };
    return settings.external?.google !== false;
  } catch {
    return true;
  }
}

/** White button with the four-colour Google "G", the way Google shows its own sign-in button. */
const BUTTON: CSSProperties = {
  width: '100%',
  minHeight: 48,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 24,
  padding: '10px 16px',
  background: '#fff',
  color: '#1f1f1f',
  border: '1px solid #4285f4',
  borderRadius: 8,
  font: 'inherit',
  fontSize: 16,
  fontWeight: 500,
  cursor: 'pointer',
};

function GoogleLogo() {
  return (
    <svg width="22" height="22" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/** "Continue with Google". After Google, the user comes back to `returnPath`. */
export function GoogleButton({
  returnPath,
  label = 'Continue with Google',
}: {
  returnPath: string;
  label?: string;
}) {
  const { notice } = useAuth();
  const [error, setError] = useState(() => (oauthRedirectError ? friendly(oauthRedirectError) : ''));
  const [busy, setBusy] = useState(false);
  useEffect(clearOAuthRedirectError, []);
  if (!supabase) return null;
  const sb = supabase;

  const go = async () => {
    setError('');
    setBusy(true);
    if (!(await googleEnabled())) {
      setBusy(false);
      return setError(OFF);
    }
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + returnPath },
    });
    // On success the browser leaves for Google, so only failures get here.
    if (error) {
      setBusy(false);
      setError(friendly(error.message));
    }
  };

  return (
    <>
      <button type="button" style={BUTTON} onClick={go} disabled={busy}>
        <GoogleLogo />
        <span>{busy ? 'Opening Google…' : label}</span>
      </button>
      {(notice || error) && <p className="error-text">{notice || error}</p>}
    </>
  );
}
