import { useQuery, type QueryKey } from '@tanstack/react-query';
import { db, must } from '../../lib/queries';
import type {
  QueueTicket,
  StaffMember,
  SupportTicket,
  TicketCategory,
  TicketMessage,
  TicketPriority,
  TicketStatus,
} from '../../lib/types';

/** Every admin support query key starts with this, so one invalidate refreshes them all. */
export const SUP_KEY = 'admin-support';
export const SUP_KEYS: QueryKey[] = [[SUP_KEY], ['admin-attention']];

export const STATUS_LABEL: Record<TicketStatus, { text: string; cls: string; help: string }> = {
  open: { text: 'Open', cls: 'pending', help: 'Waiting for us to answer' },
  waiting: { text: 'Waiting', cls: '', help: 'We answered; waiting for them' },
  resolved: { text: 'Resolved', cls: 'approved', help: 'Sorted; they can still reply' },
  closed: { text: 'Closed', cls: 'rejected', help: 'Finished' },
};

export const CATEGORY_LABEL: Record<TicketCategory, string> = {
  billing: 'Billing',
  account: 'Account',
  offers: 'Offers',
  scratch: 'Scratch & Win',
  technical: 'Technical',
  other: 'Other',
};

export const PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
};

/** "5 min ago", "3 h ago", else a date. */
export function ago(iso: string) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function useQueue(status: TicketStatus | null) {
  return useQuery({
    queryKey: [SUP_KEY, 'queue', status],
    queryFn: async () => must<QueueTicket[]>(await db().rpc('support_queue', { p_status: status })),
  });
}

export function useTicket(id: number | null) {
  return useQuery({
    queryKey: [SUP_KEY, 'ticket', id],
    queryFn: async () =>
      must<SupportTicket>(await db().from('support_tickets').select('*').eq('id', id!).single()),
    enabled: id != null,
  });
}

export function useMessages(id: number | null) {
  return useQuery({
    queryKey: [SUP_KEY, 'messages', id],
    queryFn: async () =>
      must<TicketMessage[]>(await db().from('ticket_messages').select('*').eq('ticket_id', id!).order('id')),
    enabled: id != null,
    refetchInterval: 30_000,
  });
}

/** admin_team() is admin-only; the support role gets no list. */
export function useStaff(enabled: boolean) {
  return useQuery({
    queryKey: [SUP_KEY, 'staff'],
    queryFn: async () => must<StaffMember[]>(await db().rpc('admin_team')),
    enabled,
  });
}

export async function postReply(ticketId: number, body: string, imageKey: string | null) {
  must(await db().rpc('post_ticket_message', { p_ticket_id: ticketId, p_body: body, p_image_key: imageKey }));
}

export async function setStatus(ticketId: number, status: TicketStatus) {
  must(await db().rpc('set_ticket_status', { p_ticket_id: ticketId, p_status: status }));
}

export async function updateTicket(
  ticketId: number,
  patch: Partial<Pick<SupportTicket, 'priority' | 'assigned_to'>>,
) {
  must(await db().from('support_tickets').update(patch).eq('id', ticketId));
}
