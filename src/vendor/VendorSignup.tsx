import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { EmailField, normalisePhone, PasswordInput } from '../auth/forms';
import { GoogleButton } from '../auth/GoogleButton';
import { AppShell, LogoHeader } from '../components/AppShell';
import { LegalLinks } from '../components/LegalLinks';
import { supabase } from '../lib/supabase';
import { VendorOnboarding } from './onboarding/VendorOnboarding';

/**
 * Creates a shop owner's account, then (once signed in) runs the vendor application: plan, shop, location,
 * hours and branches.
 */
export default function VendorSignup() {
  const { session, roles, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sentTo, setSentTo] = useState('');
  const isVendor = roles.includes('vendor');

  useEffect(() => {
    if (!loading && session && isVendor) navigate('/vendor', { replace: true });
  }, [loading, session, isVendor, navigate]);

  if (!supabase) return null;
  const sb = supabase;

  // Signed in (e.g. back from "Register with Google") but not a vendor yet: just the business details.
  if (session && !loading && !isVendor) {
    return (
      <AppShell header={<LogoHeader />}>
        <section className="hero">
          <h1>Register your business</h1>
          <p>
            Signed in as <b>{session.user.email}</b>. Choose a plan and tell us about your shop.
          </p>
          <span className="hero-pill">For shop owners</span>
        </section>
        <section className="section">
          <VendorOnboarding />
        </section>
        <p className="meta" style={{ textAlign: 'center' }}>
          Not you?{' '}
          <button className="link-btn" onClick={signOut}>
            Sign out
          </button>
        </p>
        <LegalLinks />
      </AppShell>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const fullName = name.trim();
    const ownerMobile = normalisePhone(mobile);
    if (fullName.length < 2) return setError('Please enter your name.');
    if (!ownerMobile) return setError('Please enter a valid 10-digit mobile number.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== password2) return setError('The two passwords do not match.');
    setBusy(true);
    const { data, error } = await sb.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          full_name: fullName,
          phone: ownerMobile,
        },
        emailRedirectTo: window.location.origin + '/vendor/login',
      },
    });
    setBusy(false);
    if (error) return setError(error.message);
    // With email confirmation on, an existing address comes back as a user with no identities.
    if (data.user && data.user.identities?.length === 0)
      return setError(
        'An account with this email already exists. Sign in, then use "Become a vendor" on your Profile.',
      );
    if (!data.session) setSentTo(email.trim());
  };

  if (sentTo) {
    return (
      <AppShell header={<LogoHeader />}>
        <section className="section form-card">
          <h3 style={{ marginTop: 0 }}>Check your email</h3>
          <p className="meta">
            We sent a confirmation link to <b>{sentTo}</b>. Tap it, then sign in to choose a plan and add your
            shop.
          </p>
          <Link className="btn block" to="/vendor/login" style={{ display: 'block', textAlign: 'center' }}>
            Go to vendor sign in
          </Link>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell header={<LogoHeader />}>
      <section className="hero">
        <h1>Register your business</h1>
        <p>
          Create your account, then choose a plan and add your shop. Customers see it after the IWILLFLY team
          approves your business.
        </p>
        <span className="hero-pill">For shop owners</span>
      </section>
      <section className="section form-card">
        <GoogleButton returnPath="/vendor/signup" label="Register with Google" />
        <p className="meta" style={{ margin: '10px 0 0', textAlign: 'center' }}>
          or fill in the form below
        </p>
      </section>
      <form className="section form-card" onSubmit={submit} noValidate>
        <h3 style={{ marginTop: 0 }}>About you</h3>
        <div className="field">
          <label htmlFor="owner-name">Your name *</label>
          <input
            id="owner-name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
          />
        </div>
        <EmailField value={email} onChange={setEmail} />
        <div className="field">
          <label htmlFor="owner-mobile">Mobile number *</label>
          <input
            id="owner-mobile"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            placeholder="98765 43210"
          />
        </div>
        <div className="field">
          <label htmlFor="new-password">Password *</label>
          <PasswordInput
            id="new-password"
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
            placeholder="At least 8 characters"
          />
        </div>
        <div className="field">
          <label htmlFor="confirm-password">Confirm password *</label>
          <PasswordInput
            id="confirm-password"
            autoComplete="new-password"
            value={password2}
            onChange={setPassword2}
            placeholder="Type it again"
          />
          {password2 && password !== password2 && <p className="error-text">Passwords do not match yet.</p>}
        </div>

        <p className="meta">Next you choose a plan and add your shop details.</p>
        {error && <p className="error-text">{error}</p>}
        <button className="btn block" type="submit" disabled={busy || loading} style={{ marginTop: 12 }}>
          {busy ? 'Creating account…' : 'Create account and continue'}
        </button>
      </form>
      <p className="meta" style={{ textAlign: 'center' }}>
        Already a vendor? <Link to="/vendor/login">Sign in</Link>
      </p>
      <LegalLinks />
    </AppShell>
  );
}
