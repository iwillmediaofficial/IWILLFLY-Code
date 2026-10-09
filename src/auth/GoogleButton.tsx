import { useEffect, useState } from 'react';
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
      <button type="button" className="btn yellow" style={{ width: '100%' }} onClick={go} disabled={busy}>
        {busy ? 'Opening Google…' : label}
      </button>
      {(notice || error) && <p className="error-text">{notice || error}</p>}
    </>
  );
}
