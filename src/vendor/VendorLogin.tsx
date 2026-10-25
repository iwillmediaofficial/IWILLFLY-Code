import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { EmailCodeForm, PasswordInput, passwordSignInError } from '../auth/forms';
import { GoogleButton } from '../auth/GoogleButton';
import { AppShell, LogoHeader } from '../components/AppShell';
import { signInEmail } from '../lib/branchLogin';
import { supabase } from '../lib/supabase';

/** Sign-in for shop owners. Opens the vendor dashboard, or points non-vendors to registration. */
export default function VendorLogin() {
  const { session, roles, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from;
  const [mode, setMode] = useState<'password' | 'code'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isVendor = roles.includes('vendor');

  useEffect(() => {
    if (!loading && session && isVendor)
      navigate(from?.startsWith('/vendor') ? from : '/vendor', { replace: true });
  }, [loading, session, isVendor, from, navigate]);

  if (!supabase) return null;
  const sb = supabase;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    // Branch logins type a username instead of an email.
    const { error } = await sb.auth.signInWithPassword({ email: signInEmail(email), password });
    setBusy(false);
    if (error) setError(passwordSignInError(error.message));
  };

  return (
    <AppShell header={<LogoHeader />}>
      <section className="hero">
        <h1>Vendor sign in</h1>
        <p>Manage your shops, offers and Scratch & Win prizes.</p>
        <span className="hero-pill">For shop owners</span>
      </section>
      <section className="section form-card">
        {session && !loading && !isVendor ? (
          <>
            <p className="meta" style={{ marginTop: 0 }}>
              <b>{session.user.email}</b> is not registered as a vendor yet.
            </p>
            <Link
              className="btn block"
              to="/vendor/apply"
              style={{ display: 'block', textAlign: 'center', marginBottom: 8 }}
            >
              Register your business with this account
            </Link>
            <button className="btn secondary block" onClick={signOut}>
              Sign out and use a different account
            </button>
          </>
        ) : mode === 'code' ? (
          <EmailCodeForm
            email={email}
            onEmail={setEmail}
            returnPath="/vendor/login"
            onBack={() => setMode('password')}
          />
        ) : (
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="email">Email or branch username</label>
              <input
                id="email"
                required
                autoComplete="username"
                autoCapitalize="none"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com or lulu-kakkanad"
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                value={password}
                onChange={setPassword}
              />
            </div>
            <button className="btn" style={{ width: '100%' }} disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <button
              type="button"
              className="btn secondary"
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => {
                setError('');
                setMode('code');
              }}
            >
              Forgot password? Email me a login code
            </button>
            <p className="meta" style={{ textAlign: 'center', marginBottom: 0 }}>
              Branch login? Ask your business owner to change your password.
            </p>
            {error && <p className="error-text">{error}</p>}
          </form>
        )}
        {!session && (
          <>
            <div className="meta" style={{ textAlign: 'center', margin: '14px 0' }}>
              or
            </div>
            <GoogleButton returnPath="/vendor/login" />
          </>
        )}
      </section>
      <p className="meta" style={{ textAlign: 'center' }}>
        New here? <Link to="/vendor/signup">Register your business</Link> ·{' '}
        <Link to="/login">Customer sign in</Link>
      </p>
    </AppShell>
  );
}
