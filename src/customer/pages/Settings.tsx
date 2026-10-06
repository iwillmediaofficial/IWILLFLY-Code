import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { AppShell, BackHeader } from '../../components/AppShell';
import { LocationChooser } from '../../components/LocationButton';
import { AreaLocationPicker } from '../../components/ScratchLocation';
import { useToast } from '../../components/Toast';
import { usePlace } from '../../lib/location';
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
