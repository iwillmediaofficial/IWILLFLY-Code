import { createContext, useContext } from 'react';
import type { MyVendor } from '../lib/types';

/** The business the signed-in user owns or works for. VendorApp only renders its pages once it has loaded. */
export const VendorContext = createContext<MyVendor | null>(null);

export function useVendor(): MyVendor {
  const v = useContext(VendorContext);
  if (!v) throw new Error('useVendor must be used inside VendorApp');
  return v;
}

/**
 * Brand-level pages (shops, Scratch & Win, festivals...) are read only for blocked vendors, Staff, and
 * anyone tied to one branch (RLS refuses their writes anyway).
 */
export function useReadOnly() {
  const v = useVendor();
  return v.status === 'blocked' || v.my_role === 'staff' || v.my_branch_id != null;
}

/** Owner and brand managers edit shops and offers; only the owner handles billing and the team. */
export function useVendorRole() {
  const v = useVendor();
  const role = v.my_role;
  return { role, isOwner: role === 'owner', canEdit: role !== 'staff' && v.my_branch_id == null };
}

/** Branch managers and branch staff work at one branch of the brand. */
export function useBranchScope() {
  const v = useVendor();
  const branchId = v.my_branch_id ?? null;
  return {
    branchId,
    branchName: v.my_branch_name ?? null,
    branchShopId: v.my_branch_shop_id ?? null,
    isBranchMember: branchId != null,
    isBranchManager: branchId != null && v.my_role === 'manager',
  };
}

/** Who may post and change offers: brand editors, and branch managers for their own branch. */
export function useCanEditOffers() {
  const v = useVendor();
  return v.status !== 'blocked' && v.my_role !== 'staff';
}

/** Whether this offer can be changed by the signed-in member (branch managers: their branch's alone). */
export function useCanEditOffer() {
  const canEdit = useCanEditOffers();
  const { branchId } = useBranchScope();
  return (offer: { all_branches: boolean }, branchIds: number[] | undefined) =>
    canEdit &&
    (branchId == null ||
      (!offer.all_branches &&
        (branchIds ?? []).length > 0 &&
        (branchIds ?? []).every((b) => b === branchId)));
}

/** Offers and pictures can be added only once the IWILLFLY team approves the business. */
export function useApproved() {
  return useVendor().status === 'approved';
}
