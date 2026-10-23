import type { InvoiceStatus } from '../lib/types';

/** The plan a vendor picked when applying, with its invoices, as embedded from vendors. */
export type PlanRef = { id: number; name: string; price: number | string } | null;
export type InvoiceRef = {
  id: number;
  number: string;
  status: InvoiceStatus;
  created_at: string;
  invoice_items: { plan_id: number | null }[];
};

/** The vendors select that brings the picked plan and its invoices along. */
export const PLAN_SELECT =
  'plan:plans(id, name, price), invoices(id, number, status, created_at, invoice_items(plan_id))';

export interface PlanPayment {
  /** Whether nothing is owed, so an admin can approve (the database checks the same). */
  ok: boolean;
  label: string;
  /** pill-status modifier */
  tone: string;
  invoiceId?: number;
}

/** Where a vendor stands on paying for the plan picked when applying; null for older vendors with none. */
export function planPayment(plan: PlanRef, invoices: InvoiceRef[] | null | undefined): PlanPayment | null {
  if (!plan) return null;
  if (Number(plan.price) === 0) return { ok: true, label: `${plan.name} · Free`, tone: 'live' };
  const planInvoices = (invoices ?? [])
    .filter((i) => i.status !== 'void' && i.invoice_items.some((it) => it.plan_id != null))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const paid = planInvoices.find((i) => i.status === 'paid');
  if (paid) return { ok: true, label: `${plan.name} · Paid`, tone: 'live', invoiceId: paid.id };
  const latest = planInvoices[0];
  if (latest?.status === 'submitted')
    return {
      ok: false,
      label: `${plan.name} · Payment sent, check it`,
      tone: 'pending',
      invoiceId: latest.id,
    };
  return { ok: false, label: `${plan.name} · Waiting for payment`, tone: 'rejected', invoiceId: latest?.id };
}
