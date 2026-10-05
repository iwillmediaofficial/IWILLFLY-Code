import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppShell, LogoHeader } from '../components/AppShell';
import { supabase } from '../lib/supabase';
import { ADMIN_ROLES, useAuth } from './AuthProvider';

/** Email + password sign-in for staff accounts created in the Supabase dashboard. No emails are sent. */
export default function AdminLogin() {
  const { session, roles, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isAdmin = roles.some((r) => ADMIN_ROLES.includes(r));

  useEffect(() => {
    if (!loading && session && isAdmin) navigate('/admin', { replace: true });
  }, [loading, session, isAdmin, navigate]);

  if (!supabase) {
    return (
      <AppShell header={<LogoHeader />}>
        <div className="form-card">
          <h3 style={{ marginTop: 0 }}>Sign in is not set up yet</h3>
        </div>
      </AppShell>
    );
  }
  const sb = supabase;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error)
      setError(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message);
  };

  return (
    <AppShell header={<LogoHeader />}>
      <section className="hero">
        <h1>Admin sign in</h1>
        <p>For IWILLFLY staff accounts only.</p>
      </section>
      <section className="section form-card">
        {session && !loading && !isAdmin ? (
          <>
            <p className="meta" style={{ marginTop: 0 }}>
              You are signed in as <b>{session.user.email}</b>, which is not an admin account.
            </p>
            <button className="btn secondary block" onClick={signOut}>
              Sign out and use an admin account
            </button>
          </>
        ) : (
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="admin-email">Email</label>
              <input
                id="admin-email"
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="admin-password">Password</label>
              <input
                id="admin-password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button className="btn block" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}
        {error && <p className="error-text">{error}</p>}
        <p className="meta" style={{ textAlign: 'center', marginBottom: 0 }}>
          <Link to="/login">Customer or vendor sign in</Link>
        </p>
      </section>
    </AppShell>
  );
}
