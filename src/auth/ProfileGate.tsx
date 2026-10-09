import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useNeedsProfile } from '../lib/profile';

/** Pages a customer can still open before finishing their profile. */
const OPEN_PATHS = ['/welcome', '/login', '/privacy', '/terms', '/points/terms', '/vendor', '/admin'];

/** Sends customers who still lack a mobile number or area (e.g. new Google sign-ups) to /welcome. */
export function ProfileGate() {
  const needs = useNeedsProfile();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const open = OPEN_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
  useEffect(() => {
    if (needs && !open) navigate('/welcome', { replace: true, state: { from: pathname } });
  }, [needs, open, pathname, navigate]);
  return null;
}
