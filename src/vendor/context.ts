import { createContext, useContext } from 'react';
import type { Vendor } from '../lib/types';

/** The signed-in vendor's own row. VendorApp only renders its pages once it has loaded. */
export const VendorContext = createContext<Vendor | null>(null);

export function useVendor(): Vendor {
  const v = useContext(VendorContext);
  if (!v) throw new Error('useVendor must be used inside VendorApp');
  return v;
}

/** Blocked vendors can look but not change anything (RLS refuses their writes anyway). */
export function useReadOnly() {
  return useVendor().status === 'blocked';
}
