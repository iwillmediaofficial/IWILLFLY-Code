import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { normalisePhone } from '../../auth/forms';
import { AppShell, BackHeader } from '../../components/AppShell';
import { LegalLinks } from '../../components/LegalLinks';
import { LocationChooser } from '../../components/LocationButton';
import { AreaLocationPicker } from '../../components/ScratchLocation';
import { useToast } from '../../components/Toast';
import { usePlace } from '../../lib/location';
import { useMyProfile, type MyProfile } from '../../lib/profile';
import { db, must } from '../../lib/queries';
import { useProfileArea } from '../../lib/profileArea';

export default function Settings() {
  const { session, signOut } = useAuth();
  const { place, setPlace } = usePlace();
  const { areaId, known } = useProfileArea();
  const toast = useToast();
  const navigate = useNavigate();

  return (
    <AppShell
      header={<BackHeader back="/profile" title="Settings" subtitle="Location, notifications & privacy" />}
    >
      <section className="section form-card" id="location">
        <h3 style={{ marginTop: 0 }}>📍 Your location</h3>
        {session ? (
          <>
            <p className="meta" style={{ lineHeight: 1.6, marginTop: 0 }}>
              Your area decides which Scratch & Win games and prizes you can play, and shows the nearest shops
              and offers first. It is saved to your account.
            </p>
            {known && areaId == null && (
              <div className="notice warn">
                <b>Set your area to play Scratch & Win.</b> Use your current location or pick it below.
              </div>
            )}
            <AreaLocationPicker />
          </>
        ) : (
          <>
            <p className="meta" style={{ lineHeight: 1.6, marginTop: 0 }}>
              Your location is used only to show the nearest shops and offers first, and is kept on this
              device. <Link to="/login">Sign in</Link> to save your area and play Scratch & Win.
            </p>
            <LocationChooser />
          </>
        )}
        {place && (
          <button
            className="link-btn"
            style={{ marginTop: 8 }}
            onClick={() => {
              setPlace(null);
              toast('Location cleared on this device');
            }}
          >
            Clear location on this device
          </button>
        )}
      </section>
      {session && <MobileSection />}
      <section className="section form-card">
        <h3 style={{ marginTop: 0 }}>🔔 Notifications</h3>
        <p className="meta" style={{ lineHeight: 1.6, marginTop: 0 }}>
          Your inbox and push alerts for festival offers, prizes and shops you save.
        </p>
        <Link className="shop-card" to="/notifications">
          <div className="shop-thumb">🔔</div>
          <div>
            <h4>Notifications</h4>
            <div className="meta">Inbox and push notifications</div>
          </div>
          <div className="chev">›</div>
        </Link>
      </section>
      <section className="section form-card">
        <h3 style={{ marginTop: 0 }}>🔒 Privacy</h3>
        <p className="meta" style={{ lineHeight: 1.6, margin: 0 }}>
          Your account keeps your sign-in email, the offers and shops you save, and your preferred area. Your
          location is used only to find nearby offers and is not shared with shops.
        </p>
        <LegalLinks />
      </section>
      <section className="section">
        {session ? (
          <button
            className="btn danger block"
            onClick={async () => {
              await signOut();
              toast('Signed out');
              navigate('/');
            }}
          >
            Sign out
          </button>
        ) : (
          <Link className="btn block" to="/login" style={{ display: 'block', textAlign: 'center' }}>
            Sign in
          </Link>
        )}
      </section>
    </AppShell>
  );
}

/** View and change the mobile number shops use to reach you about prizes. */
function MobileSection() {
  const profile = useMyProfile();
  return (
    <section className="section form-card" id="mobile">
      <h3 style={{ marginTop: 0 }}>📱 Mobile number</h3>
      <p className="meta" style={{ lineHeight: 1.6, marginTop: 0 }}>
        Shops use this to reach you when you win a prize.
      </p>
      {profile.data ? <MobileForm profile={profile.data} /> : <p className="meta">Loading…</p>}
    </section>
  );
}

function MobileForm({ profile }: { profile: MyProfile }) {
  const { session } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const saved = profile.phone?.replace(/^\+91/, '') ?? '';
  const [phone, setPhone] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const mobile = normalisePhone(phone);
    if (!mobile) return setError('Please enter a valid 10-digit mobile number.');
    setError('');
    setBusy(true);
    try {
      const userId = session!.user.id;
      must(await db().from('profiles').update({ phone: mobile }).eq('id', userId));
      await qc.invalidateQueries({ queryKey: ['my-profile', userId] });
      setPhone(mobile.replace(/^\+91/, ''));
      toast('Mobile number saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save}>
      <div className="field">
        <label htmlFor="settings-phone">Mobile number</label>
        <input
          id="settings-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="98765 43210"
        />
      </div>
      {error && <p className="error-text">{error}</p>}
      <button className="btn" disabled={busy || phone.trim() === saved}>
        {busy ? 'Saving…' : 'Save mobile number'}
      </button>
    </form>
  );
}
