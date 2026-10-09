import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { EmailField, normalisePhone, PasswordInput } from '../auth/forms';
import { AppShell, LogoHeader } from '../components/AppShell';
import { LegalLinks } from '../components/LegalLinks';
import { supabase } from '../lib/supabase';

/**
 * One form that creates a shop owner's account and their vendor application together.
 * The application rides along in the sign-up metadata and is filed by AuthProvider once there is a
 * session (straight away, or after the email is confirmed).
 */
export default function VendorSignup() {
  const { session, roles, loading } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [business, setBusiness] = useState('');
  const [bizPhone, setBizPhone] = useState('');
  const [waSame, setWaSame] = useState(true);
  const [whatsapp, setWhatsapp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sentTo, setSentTo] = useState('');
  const isVendor = roles.includes('vendor');

  useEffect(() => {
    if (!loading && session && isVendor) navigate('/vendor', { replace: true });
  }, [loading, session, isVendor, navigate]);

  if (!supabase) return null;
  const sb = supabase;

  if (session && !loading && !isVendor) {
    return (
      <AppShell header={<LogoHeader />}>
        <section className="section form-card">
          <h3 style={{ marginTop: 0 }}>You are signed in</h3>
          <p className="meta">
            Signed in as <b>{session.user.email}</b>. Add your business details to this account to start
            selling.
          </p>
          <Link className="btn block" to="/vendor/apply" style={{ display: 'block', textAlign: 'center' }}>
            Register your business
          </Link>
        </section>
      </AppShell>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const fullName = name.trim();
    const biz = business.trim();
    const ownerMobile = normalisePhone(mobile);
    const businessPhone = bizPhone.trim() ? normalisePhone(bizPhone) : ownerMobile;
    const wa = waSame ? ownerMobile : whatsapp.trim() ? normalisePhone(whatsapp) : '';
    if (fullName.length < 2) return setError('Please enter your name.');
    if (!ownerMobile) return setError('Please enter a valid 10-digit mobile number.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== password2) return setError('The two passwords do not match.');
    if (biz.length < 2 || biz.length > 120) return setError('Business name should be 2 to 120 characters.');
    if (!businessPhone) return setError('Business phone: please enter a valid 10-digit number.');
    if (wa === null) return setError('WhatsApp: please enter a valid 10-digit number.');
    setBusy(true);
    const { data, error } = await sb.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          full_name: fullName,
          phone: ownerMobile,
          vendor_application: { business_name: biz, phone: businessPhone, whatsapp: wa },
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
            We sent a confirmation link to <b>{sentTo}</b>. Tap it, then sign in. Your business is registered
            the first time you sign in.
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
          Create your vendor account to list your shops and post offers. Customers see them after the IWILLFLY
          team approves your business.
        </p>
        <span className="hero-pill">For shop owners</span>
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

        <h3>About your business</h3>
        <div className="field">
          <label htmlFor="biz-name">Business name *</label>
          <input
            id="biz-name"
            autoComplete="organization"
            value={business}
            onChange={(e) => setBusiness(e.target.value)}
            maxLength={120}
          />
        </div>
        <div className="field">
          <label htmlFor="biz-phone">Business phone</label>
          <input
            id="biz-phone"
            type="tel"
            inputMode="tel"
            value={bizPhone}
            onChange={(e) => setBizPhone(e.target.value)}
            placeholder="Leave empty to use your mobile"
          />
        </div>
        <label className="meta" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <input type="checkbox" checked={waSame} onChange={(e) => setWaSame(e.target.checked)} />
          WhatsApp number is the same as my mobile
        </label>
        {!waSame && (
          <div className="field">
            <label htmlFor="biz-wa">WhatsApp</label>
            <input
              id="biz-wa"
              type="tel"
              inputMode="tel"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="Optional"
            />
          </div>
        )}
        <p className="meta">You add your shops, their locations and categories after signing up.</p>
        {error && <p className="error-text">{error}</p>}
        <button className="btn block" type="submit" disabled={busy || loading} style={{ marginTop: 12 }}>
          {busy ? 'Creating account…' : 'Create vendor account'}
        </button>
      </form>
      <p className="meta" style={{ textAlign: 'center' }}>
        Already a vendor? <Link to="/vendor/login">Sign in</Link>
      </p>
      <LegalLinks />
    </AppShell>
  );
}
