import { createContext, useContext } from 'react';
import type { MyVendor } from '../lib/types';

/** The business the signed-in user owns or works for. VendorApp only renders its pages once it has loaded. */
export const VendorContext = createContext<MyVendor | null>(null);

export function useVendor(): MyVendor {
  const v = useContext(VendorContext);
  if (!v) throw new Error('useVendor must be used inside VendorApp');
  return v;
}

/** Blocked vendors can look but not change anything (RLS refuses their writes anyway). */
export function useReadOnly() {
  const v = useVendor();
  return v.status === 'blocked' || v.my_role === 'staff';
}

/** Owner and managers edit shops and offers; only the owner handles billing and the team. */
export function useVendorRole() {
  const role = useVendor().my_role;
  return { role, isOwner: role === 'owner', canEdit: role !== 'staff' };
}
