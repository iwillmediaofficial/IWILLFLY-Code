import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AppShell, LogoHeader } from '../components/AppShell';
import { AreaPicker } from '../components/AreaPicker';
import { LegalLinks } from '../components/LegalLinks';
import { supabase } from '../lib/supabase';
import { homeFor, useAuth } from './AuthProvider';
import { EmailCodeForm, EmailField, normalisePhone, PasswordInput, passwordSignInError } from './forms';

type Mode = 'signin' | 'signup' | 'code';

export default function Login() {
  const { session, roles, loading } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from;
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [areaId, setAreaId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

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

  const switchMode = (m: Mode) => {
    setMode(m);
    setError('');
    setNotice('');
  };

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(passwordSignInError(error.message));
  };

  const signUp = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    const fullName = name.trim();
    const mobile = normalisePhone(phone);
    if (fullName.length < 2) return setError('Please enter your name.');
    if (!mobile) return setError('Please enter a valid 10-digit mobile number.');
    if (areaId == null) return setError('Please choose your location.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== password2) return setError('The two passwords do not match.');
    setBusy(true);
    // The profile row is filled from this metadata on first sign-in (see AuthProvider).
    const { data, error } = await sb.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: fullName, phone: mobile, location_id: areaId },
        emailRedirectTo: window.location.origin + '/login',
      },
    });
    setBusy(false);
    if (error) return setError(error.message);
    // With email confirmation on, an existing address comes back as a user with no identities.
    if (data.user && data.user.identities?.length === 0) {
      setMode('signin');
      return setError('An account with this email already exists. Please sign in.');
    }
    if (!data.session) {
      setMode('signin');
      setPassword('');
      setPassword2('');
      setNotice(`We sent a confirmation link to ${email.trim()}. Tap it, then sign in here.`);
    }
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
        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode !== 'signup'}
            className={mode !== 'signup' ? 'active' : ''}
            onClick={() => switchMode('signin')}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signup'}
            className={mode === 'signup' ? 'active' : ''}
            onClick={() => switchMode('signup')}
          >
            Create account
          </button>
        </div>

        {notice && <p className="notice">{notice}</p>}

        {mode === 'signin' && (
          <form onSubmit={signIn}>
            <EmailField value={email} onChange={setEmail} />
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
              onClick={() => switchMode('code')}
            >
              Forgot password? Email me a login code
            </button>
          </form>
        )}

        {mode === 'signup' && (
          <form onSubmit={signUp}>
            <div className="field">
              <label htmlFor="name">Your name</label>
              <input
                id="name"
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
              />
            </div>
            <EmailField value={email} onChange={setEmail} />
            <div className="field">
              <label htmlFor="phone">Mobile number</label>
              <input
                id="phone"
                type="tel"
                inputMode="tel"
                required
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="98765 43210"
              />
            </div>
            <AreaPicker label="Your location" value={areaId} onChange={(a) => setAreaId(a?.id ?? null)} />
            <div className="field">
              <label htmlFor="new-password">Password</label>
              <PasswordInput
                id="new-password"
                autoComplete="new-password"
                value={password}
                onChange={setPassword}
                placeholder="At least 8 characters"
              />
            </div>
            <div className="field">
              <label htmlFor="confirm-password">Confirm password</label>
              <PasswordInput
                id="confirm-password"
                autoComplete="new-password"
                value={password2}
                onChange={setPassword2}
                placeholder="Type it again"
              />
              {password2 && password !== password2 && (
                <p className="error-text">Passwords do not match yet.</p>
              )}
            </div>
            <button className="btn" style={{ width: '100%' }} disabled={busy}>
              {busy ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        )}

        {mode === 'code' && (
          <EmailCodeForm
            email={email}
            onEmail={setEmail}
            returnPath="/login"
            onBack={() => switchMode('signin')}
          />
        )}

        <div className="meta" style={{ textAlign: 'center', margin: '14px 0' }}>
          or
        </div>
        <button className="btn yellow" style={{ width: '100%' }} onClick={google}>
          Continue with Google
        </button>
        {error && <p className="error-text">{error}</p>}
      </section>
      <p className="meta" style={{ textAlign: 'center' }}>
        Shop owner? <Link to="/vendor/signup">Register your business</Link> ·{' '}
        <Link to="/vendor/login">Vendor sign in</Link>
      </p>
      <LegalLinks />
    </AppShell>
  );
}
