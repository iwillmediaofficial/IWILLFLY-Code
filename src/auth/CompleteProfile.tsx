import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AppShell, LogoHeader } from '../components/AppShell';
import { AreaPicker } from '../components/AreaPicker';
import { LegalLinks } from '../components/LegalLinks';
import { useMyProfile, useNeedsProfile, type MyProfile } from '../lib/profile';
import { db, must } from '../lib/queries';
import { useAuth } from './AuthProvider';
import { normalisePhone } from './forms';

export default function CompleteProfile() {
  const { session, loading } = useAuth();
  const profile = useMyProfile();
  if (!loading && !session) return <Navigate to="/login" replace />;
  if (!profile.data) {
    return (
      <AppShell header={<LogoHeader />}>
        <p className="meta">Loading…</p>
      </AppShell>
    );
  }
  return <ProfileForm initial={profile.data} />;
}

/** Starts from whatever the profile already has (Google gives the name). */
function ProfileForm({ initial }: { initial: MyProfile }) {
  const { session, signOut } = useAuth();
  const needs = useNeedsProfile();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';
  const [name, setName] = useState(initial.full_name ?? '');
  const [phone, setPhone] = useState(initial.phone?.replace(/^\+91/, '') ?? '');
  const [areaId, setAreaId] = useState(initial.location_id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!needs && !busy) return <Navigate to={from} replace />;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const fullName = name.trim();
    const mobile = normalisePhone(phone);
    if (fullName.length < 2) return setError('Please enter your name.');
    if (!mobile) return setError('Please enter a valid 10-digit mobile number.');
    if (areaId == null) return setError('Please choose your location.');
    setBusy(true);
    try {
      const userId = session!.user.id;
      must(
        await db()
          .from('profiles')
          .update({ full_name: fullName, phone: mobile, location_id: areaId })
          .eq('id', userId),
      );
      await qc.invalidateQueries({ queryKey: ['my-profile', userId] });
      await qc.invalidateQueries({ queryKey: ['profile-area', userId] });
      // Which Scratch & Win campaigns the customer can play depends on their area.
      await qc.refetchQueries({ queryKey: ['scratch_today'] });
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save. Please try again.');
      setBusy(false);
    }
  };

  return (
    <AppShell header={<LogoHeader />}>
      <section className="hero">
        <h1>Almost done</h1>
        <p>
          Add your mobile number and area so shops can reach you about prizes and we can show offers near you.
        </p>
      </section>
      <section className="section form-card">
        <form onSubmit={save}>
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
          {error && <p className="error-text">{error}</p>}
          <button className="btn" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'Saving…' : 'Continue'}
          </button>
        </form>
      </section>
      <p className="meta" style={{ textAlign: 'center' }}>
        Not you?{' '}
        <Link
          to="/login"
          onClick={async (e) => {
            e.preventDefault();
            await signOut();
            navigate('/login', { replace: true });
          }}
        >
          Sign out
        </Link>
      </p>
      <LegalLinks />
    </AppShell>
  );
}
