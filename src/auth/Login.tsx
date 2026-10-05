import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AppShell, LogoHeader } from '../components/AppShell';
import { supabase } from '../lib/supabase';
import { homeFor, useAuth } from './AuthProvider';

export default function Login() {
  const { session, roles, loading } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from;
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && session) navigate(from ?? homeFor(roles), { replace: true });
  }, [loading, session, roles, from, navigate]);

  if (!supabase) {
    return (
      <AppShell header={<LogoHeader />}>
        <div className="form-card">
          <h3 style={{ marginTop: 0 }}>Sign in is not set up yet</h3>
          <p className="meta">
            Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to the environment, then reload.
          </p>
        </div>
      </AppShell>
    );
  }
  const sb = supabase;

  const sendCode = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error } = await sb.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin + '/login' },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error } = await sb.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) setError(error.message);
  };

  const google = async () => {
    setError('');
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/login' },
    });
    if (error) setError(error.message);
  };

  return (
    <AppShell header={<LogoHeader />}>
      <section className="hero">
        <h1>Welcome to IWILLFLY</h1>
        <p>Sign in to save offers, play the daily Scratch & Win and claim your prizes.</p>
      </section>
      <section className="section form-card">
        {!sent ? (
          <form onSubmit={sendCode}>
            <div className="field">
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <button className="btn" style={{ width: '100%' }} disabled={busy}>
              {busy ? 'Sending…' : 'Send login code'}
            </button>
          </form>
        ) : (
          <form onSubmit={verify}>
            <p className="meta" style={{ marginTop: 0 }}>
              We emailed a code to <b>{email}</b>. Enter it below, or tap the link in the email.
            </p>
            <div className="field">
              <label htmlFor="code">Login code</label>
              <input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
              />
            </div>
            <button className="btn" style={{ width: '100%' }} disabled={busy}>
              {busy ? 'Checking…' : 'Verify and sign in'}
            </button>
            <button
              type="button"
              className="btn secondary"
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => setSent(false)}
            >
              Use a different email
            </button>
          </form>
        )}
        <div className="meta" style={{ textAlign: 'center', margin: '14px 0' }}>
          or
        </div>
        <button className="btn yellow" style={{ width: '100%' }} onClick={google}>
          Continue with Google
        </button>
        {error && <p className="error-text">{error}</p>}
      </section>
    </AppShell>
  );
}
