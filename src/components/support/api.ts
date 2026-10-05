import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { db, must } from '../../lib/queries';
import type { SupportTicket, TicketCategory, TicketMessage, TicketStatus } from '../../lib/types';

/**
 * Where the help screens run: the vendor app (tickets about the business) or the customer app
 * (the person's own tickets). Decides the query keys, links and how a new ticket is filed.
 */
export interface SupportScope {
  keyBase: readonly string[];
  basePath: string;
  forBusiness: boolean;
  /** The business whose tickets to list (vendor app only). */
  vendorId: number | null;
}

export const customerScope: SupportScope = {
  keyBase: ['support'],
  basePath: '/help',
  forBusiness: false,
  vendorId: null,
};

export function vendorScope(vendorId: number): SupportScope {
  return { keyBase: ['vendor', 'support'], basePath: '/vendor/help', forBusiness: true, vendorId };
}

export const statusLabel: Record<TicketStatus, string> = {
  open: 'Open',
  waiting: 'Replied',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const statusClass: Record<TicketStatus, string> = {
  open: 'pending',
  waiting: 'featured',
  resolved: 'live',
  closed: '',
};

export const statusHint: Record<TicketStatus, string> = {
  open: 'Waiting for IWILLFLY support to reply.',
  waiting: 'IWILLFLY support replied. Over to you.',
  resolved: 'Support marked this as solved. Reply if you still need help.',
  closed: 'This ticket is closed. Reply to open it again.',
};

export const categoryLabel: Record<TicketCategory, string> = {
  billing: 'Plans & payments',
  account: 'Account & sign in',
  offers: 'Shops & offers',
  scratch: 'Scratch & Win',
  technical: 'App problem',
  other: 'Something else',
};

/** Categories offered on the new-ticket form; customers have no billing. */
export function categoriesFor(scope: SupportScope): TicketCategory[] {
  const all = Object.keys(categoryLabel) as TicketCategory[];
  return scope.forBusiness ? all : all.filter((c) => c !== 'billing');
}

/** "5 Oct 2026, 4:00 pm" in India time */
export function formatWhen(ts: string) {
  return new Date(ts).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

export function useTickets(scope: SupportScope) {
  const { session } = useAuth();
  const uid = session?.user.id;
  return useQuery({
    queryKey: [...scope.keyBase, 'tickets', scope.vendorId, uid],
    queryFn: async () => {
      let q = db().from('support_tickets').select('*');
      // The business sees every ticket filed for it; elsewhere only the person's own personal tickets.
      q =
        scope.vendorId != null
          ? q.eq('vendor_id', scope.vendorId)
          : q.is('vendor_id', null).eq('opened_by', uid!);
      return must<SupportTicket[]>(await q.order('last_message_at', { ascending: false }).limit(100));
    },
    enabled: Boolean(uid),
  });
}

export function useTicket(scope: SupportScope, id: number) {
  return useQuery({
    queryKey: [...scope.keyBase, 'ticket', id],
    queryFn: async () => {
      const ticket = must<SupportTicket | null>(
        await db().from('support_tickets').select('*').eq('id', id).maybeSingle(),
      );
      const messages = ticket
        ? must<TicketMessage[]>(
            await db()
              .from('ticket_messages')
              .select('*')
              .eq('ticket_id', id)
              .order('id', { ascending: true }),
          )
        : [];
      return { ticket, messages };
    },
    enabled: Number.isFinite(id),
  });
}

export function useOpenTicket(scope: SupportScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (t: {
      subject: string;
      category: TicketCategory;
      body: string;
      imageKey: string | null;
    }) =>
      must<number>(
        await db().rpc('open_ticket', {
          p_subject: t.subject,
          p_category: t.category,
          p_body: t.body,
          p_image_key: t.imageKey,
          p_for_business: scope.forBusiness,
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...scope.keyBase] }),
  });
}

export function usePostMessage(scope: SupportScope, ticketId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (m: { body: string; imageKey: string | null }) =>
      must(
        await db().rpc('post_ticket_message', {
          p_ticket_id: ticketId,
          p_body: m.body,
          p_image_key: m.imageKey,
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...scope.keyBase] }),
  });
}

export function useCloseTicket(scope: SupportScope, ticketId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      must(await db().rpc('set_ticket_status', { p_ticket_id: ticketId, p_status: 'closed' })),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...scope.keyBase] }),
  });
}

/** Only accounts that may upload images (vendors and IWILLFLY staff) get the photo field. */
const UPLOAD_ROLES = ['vendor', 'admin', 'super_admin', 'campaign_manager'];
export function useCanUpload() {
  const { roles } = useAuth();
  return roles.some((r) => UPLOAD_ROLES.includes(r));
}
