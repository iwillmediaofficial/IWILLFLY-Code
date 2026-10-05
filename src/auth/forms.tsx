import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

/** Indian mobile numbers: 10 digits starting 6-9, with or without +91. Returns +91XXXXXXXXXX or null. */
// eslint-disable-next-line react-refresh/only-export-components
export function normalisePhone(raw: string) {
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

/** Friendlier text for the errors signInWithPassword returns most often. */
// eslint-disable-next-line react-refresh/only-export-components
export function passwordSignInError(message: string) {
  if (message === 'Invalid login credentials')
    return 'Wrong email or password. If you signed up with a login code or Google, use that instead.';
  if (message === 'Email not confirmed')
    return 'Please confirm your email first. Tap the link we sent when you created your account.';
  return message;
}

export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="password-wrap">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        required
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Hide password' : 'Show password'}
        aria-pressed={show}
      >
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

export function EmailField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <label htmlFor="email">Email address</label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="you@example.com"
      />
    </div>
  );
}

/** Emails a one-time login code and verifies it. The emailed link returns to `returnPath`. */
export function EmailCodeForm({
  email,
  onEmail,
  returnPath,
  onBack,
}: {
  email: string;
  onEmail: (v: string) => void;
  returnPath: string;
  onBack: () => void;
}) {
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!supabase) return null;
  const sb = supabase;

  const sendCode = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error } = await sb.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin + returnPath },
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

  return !sent ? (
    <form onSubmit={sendCode}>
      <EmailField value={email} onChange={onEmail} />
      <button className="btn" style={{ width: '100%' }} disabled={busy}>
        {busy ? 'Sending…' : 'Send login code'}
      </button>
      <button
        type="button"
        className="btn secondary"
        style={{ width: '100%', marginTop: 8 }}
        onClick={onBack}
      >
        Sign in with password
      </button>
      {error && <p className="error-text">{error}</p>}
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
      {error && <p className="error-text">{error}</p>}
    </form>
  );
}
