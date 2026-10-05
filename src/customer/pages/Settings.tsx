import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { AppShell, BackHeader } from '../../components/AppShell';
import { locationPath } from '../../lib/locationPath';
import { LocationChooser } from '../../components/LocationButton';
import { useToast } from '../../components/Toast';
import { usePlace } from '../../lib/location';
import { db, must, useLocations } from '../../lib/queries';
import { supabase } from '../../lib/supabase';
import { errorText } from '../util';

function useProfileArea(userId: string | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['profile-area', userId],
    queryFn: async () =>
      must<{ location_id: number | null } | null>(
        await db().from('profiles').select('location_id').eq('id', userId!).maybeSingle(),
      ),
    enabled: Boolean(supabase && userId),
  });
  const save = useMutation({
    mutationFn: async (locationId: number) => {
      must(await db().from('profiles').update({ location_id: locationId }).eq('id', userId!));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['profile-area', userId] }),
  });
  return { area: query.data?.location_id ?? null, save };
}

export default function Settings() {
  const { session, signOut } = useAuth();
  const { place, setPlace } = usePlace();
  const toast = useToast();
  const navigate = useNavigate();
  const userId = session?.user.id;
  const { area, save } = useProfileArea(userId);
  const { data: locations = [] } = useLocations();

  const onArea = (id: number) => {
    if (!userId) return;
    save.mutate(id, {
      onSuccess: () => toast('Saved as your preferred area'),
      onError: (e) => toast(errorText(e)),
    });
  };

  return (
    <AppShell
      header={<BackHeader back="/profile" title="Settings" subtitle="Location, notifications & privacy" />}
    >
      <section className="section form-card">
        <h3 style={{ marginTop: 0 }}>📍 Location</h3>
        <p className="meta" style={{ lineHeight: 1.6, marginTop: 0 }}>
          Your location is used only to show the nearest shops and offers first. It is kept on this device; an
          area you pick while signed in is also saved to your account.
        </p>
        <LocationChooser onArea={onArea} />
        {session && area != null && locations.length > 0 && (
          <div className="meta" style={{ marginTop: 4 }}>
            Saved to your account: {locationPath(locations, area)}
          </div>
        )}
        {place && (
          <button
            className="link-btn"
            style={{ marginTop: 8 }}
            onClick={() => {
              setPlace(null);
              toast('Location cleared');
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
