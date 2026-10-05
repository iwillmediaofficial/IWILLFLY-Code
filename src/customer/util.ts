import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useToast } from '../components/Toast';
import { useToggleSaved } from '../lib/queries';

/** Prototype gradient tones for offer tiles, cycled by position. */
const tones = ['pink', 'green', 'orange', ''];
export const toneFor = (i: number) => tones[i % tones.length];

export function errorText(e: unknown) {
  return e instanceof Error ? e.message : 'Something went wrong. Please try again.';
}

/** "Valid till 12 Oct" style label for an offer's end date. */
export function validity(endsOn: string | null | undefined) {
  if (!endsOn) return 'No end date';
  const d = new Date(`${endsOn}T00:00:00`);
  return `Valid till ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
}

export function formatDate(day: string) {
  return new Date(`${day}T00:00:00`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Digits only, with India's 91 prefix for wa.me links. */
export function whatsappLink(num: string) {
  const digits = num.replace(/\D/g, '');
  const full = digits.length === 10 ? `91${digits}` : digits.replace(/^0+/, '');
  return `https://wa.me/${full}`;
}

export function directionsLink(lat: number, lng: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

/**
 * Save/unsave an offer or shop with sign-in and error handling.
 * Signed-out users get a toast and are sent to /login.
 */
export function useSaveToggle(kind: 'offer' | 'shop') {
  const { session } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const toggle = useToggleSaved(kind);
  const { mutate } = toggle;
  const run = useCallback(
    (id: number, saved: boolean) => {
      if (!session) {
        toast(`Sign in to save ${kind}s`);
        navigate('/login');
        return;
      }
      mutate(
        { id, saved },
        {
          onSuccess: () =>
            toast(saved ? 'Removed from saved' : kind === 'offer' ? 'Offer saved' : 'Shop saved'),
          onError: (e) => toast(errorText(e)),
        },
      );
    },
    [session, toast, navigate, mutate, kind],
  );
  return { run, pending: toggle.isPending };
}
