import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, Navigate, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { ImageField } from '../../components/ImageField';
import { useToast } from '../../components/Toast';
import { mediaUrl } from '../../lib/supabase';
import type { QueueTicket, SupportTicket, TicketPriority, TicketStatus } from '../../lib/types';
import { Empty, ErrorNotice, Loading } from '../ui';
import { formatDate, useInvalidate } from '../util';
import {
  CATEGORY_LABEL,
  PRIORITY_LABEL,
  STATUS_LABEL,
  SUP_KEYS,
  ago,
  postReply,
  setStatus,
  updateTicket,
  useMessages,
  useQueue,
  useStaff,
  useTicket,
} from './api';

export default function SupportAdmin() {
  return (
    <Routes>
      <Route index element={<Queue />} />
      <Route path=":id" element={<TicketDetail />} />
      <Route path="*" element={<Navigate to="/admin/support" replace />} />
    </Routes>
  );
}

function StatusPill({ status }: { status: TicketStatus }) {
  const s = STATUS_LABEL[status];
  return <span className={`pill-status ${s.cls}`}>{s.text}</span>;
}

type Filter = TicketStatus | 'all';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'closed', label: 'Closed' },
];

function Queue() {
  const [params, setParams] = useSearchParams();
  const filter = FILTERS.find((f) => f.key === params.get('status'))?.key ?? 'all';
  const queue = useQueue(filter === 'all' ? null : filter);
  const [mineOnly, setMineOnly] = useState(false);
  const { session } = useAuth();
  const me = session?.user.id;
  const rows = (queue.data ?? []).filter((t) => !mineOnly || t.assigned_to === me);

  return (
    <>
      <div className="section-head">
        <h2>Support</h2>
      </div>
      <div className="filter-bar" role="tablist" style={{ marginTop: 0 }}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            className={`chip${filter === f.key ? ' active' : ''}`}
            onClick={() => setParams({ status: f.key }, { replace: true })}
          >
            {f.label}
          </button>
        ))}
      </div>
      <label className="check-row">
        <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
        Only tickets assigned to me
      </label>
      {queue.isPending && <Loading />}
      {queue.error && <ErrorNotice error={queue.error} />}
      {queue.data && rows.length === 0 && (
        <Empty emoji="💬" title={filter === 'open' || filter === 'all' ? 'No tickets here' : 'Nothing here'}>
          {filter === 'open' ? 'New help requests from customers and vendors show up here.' : undefined}
        </Empty>
      )}
      <div className="list">
        {rows.map((t) => (
          <QueueRow key={t.id} ticket={t} me={me} />
        ))}
      </div>
    </>
  );
}

function QueueRow({ ticket: t, me }: { ticket: QueueTicket; me: string | undefined }) {
  const who = t.business_name ?? t.opener_name ?? t.opener_email ?? 'Someone';
  return (
    <Link className="shop-card" to={`/admin/support/${t.id}`}>
      <div className="shop-thumb">{t.vendor_id != null ? '🏪' : '🙂'}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
          <StatusPill status={t.status} />
          {t.priority === 'high' && <span className="pill-status blocked">High</span>}
          {t.status === 'open' && !t.last_from_staff && (
            <span className="pill-status featured">Needs reply</span>
          )}
        </div>
        <h4>{t.subject}</h4>
        <div className="meta">
          {who} · {CATEGORY_LABEL[t.category] ?? t.category} · {ago(t.last_message_at)}
        </div>
        <div className="meta">
          #{t.id} ·{' '}
          {t.assigned_to
            ? t.assigned_to === me
              ? 'Assigned to you'
              : `Assigned to ${t.assignee_email ?? 'someone'}`
            : 'Not assigned'}
        </div>
      </div>
      <div className="chev">›</div>
    </Link>
  );
}

// Ticket -------------------------------------------------------------------------------------------

function TicketDetail() {
  const { id } = useParams();
  const ticketId = id != null && /^\d+$/.test(id) ? Number(id) : null;
  const ticket = useTicket(ticketId);
  const messages = useMessages(ticketId);
  // The queue carries the opener's name, email and business; closed tickets far down may be missing.
  const queue = useQueue(null);
  const info = queue.data?.find((t) => t.id === ticketId);

  if (ticketId == null) return <ErrorNotice error={new Error('No such ticket.')} />;
  const t = ticket.data;

  return (
    <>
      <div className="section-head">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {t?.subject ?? 'Ticket'}
          </span>
          {t && <StatusPill status={t.status} />}
        </h2>
        <Link to="/admin/support">‹ All tickets</Link>
      </div>
      {ticket.isPending && <Loading />}
      {ticket.error && <ErrorNotice error={ticket.error} />}
      {t && (
        <>
          <div className="manage-card">
            <div style={{ fontSize: 13, display: 'grid', gap: 2 }}>
              <div>
                <span className="meta">From:</span>{' '}
                <b>{info?.opener_name ?? info?.opener_email ?? 'Unknown'}</b>
                {info?.opener_name && info.opener_email && (
                  <>
                    {' · '}
                    <a href={`mailto:${info.opener_email}`} style={{ color: 'var(--color-blue)' }}>
                      {info.opener_email}
                    </a>
                  </>
                )}
              </div>
              {t.vendor_id != null && (
                <div>
                  <span className="meta">Business:</span> {info?.business_name ?? `Vendor #${t.vendor_id}`}
                </div>
              )}
              <div>
                <span className="meta">Topic:</span> {CATEGORY_LABEL[t.category] ?? t.category} ·{' '}
                <span className="meta">opened</span> {formatDate(t.created_at)} · #{t.id}
              </div>
            </div>
            <TicketControls ticket={t} />
          </div>

          <section style={{ marginTop: 14 }}>
            {messages.isPending && <Loading />}
            {messages.error && <ErrorNotice error={messages.error} />}
            <div style={{ display: 'grid', gap: 8 }}>
              {messages.data?.map((m) => (
                <div
                  key={m.id}
                  style={{
                    justifySelf: m.is_staff ? 'end' : 'start',
                    maxWidth: '88%',
                    background: m.is_staff ? 'var(--color-blue-soft)' : '#fff',
                    border: '1px solid var(--color-line)',
                    borderRadius: 16,
                    padding: '10px 12px',
                    fontSize: 14,
                  }}
                >
                  <div className="meta" style={{ marginBottom: 4 }}>
                    <b>{m.is_staff ? 'IWILLFLY support' : (info?.opener_name ?? 'Them')}</b> ·{' '}
                    {new Date(m.created_at).toLocaleString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.body}</div>
                  {m.image_key && (
                    <a href={mediaUrl(m.image_key)} target="_blank" rel="noreferrer">
                      <img
                        src={mediaUrl(m.image_key)}
                        alt="Attached screenshot"
                        style={{ display: 'block', maxWidth: '100%', borderRadius: 10, marginTop: 8 }}
                      />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </section>

          <ReplyForm ticket={t} />
        </>
      )}
    </>
  );
}

function TicketControls({ ticket: t }: { ticket: SupportTicket }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const { session, roles } = useAuth();
  const me = session?.user.id;
  const isAdmin = roles.includes('admin') || roles.includes('super_admin');
  const staff = useStaff(isAdmin);

  const status = useMutation({
    mutationFn: (s: TicketStatus) => setStatus(t.id, s),
    onSuccess: (_, s) => {
      invalidate(...SUP_KEYS);
      toast(`Marked ${STATUS_LABEL[s].text.toLowerCase()}`);
    },
    onError: (e) => toast(e instanceof Error ? e.message : String(e)),
  });

  const update = useMutation({
    mutationFn: (patch: Partial<Pick<SupportTicket, 'priority' | 'assigned_to'>>) =>
      updateTicket(t.id, patch),
    onSuccess: (_, patch) => {
      invalidate(...SUP_KEYS);
      toast('assigned_to' in patch ? (patch.assigned_to ? 'Assigned' : 'Unassigned') : 'Priority changed');
    },
    onError: (e) => toast(e instanceof Error ? e.message : String(e)),
  });

  const busy = status.isPending || update.isPending;
  return (
    <>
      <div className="filter-bar" role="radiogroup" aria-label="Status" style={{ margin: '10px 0 0' }}>
        {(Object.keys(STATUS_LABEL) as TicketStatus[]).map((s) => (
          <button
            key={s}
            role="radio"
            aria-checked={t.status === s}
            title={STATUS_LABEL[s].help}
            disabled={busy}
            className={`chip${t.status === s ? ' active' : ''}`}
            onClick={() => t.status !== s && status.mutate(s)}
          >
            {STATUS_LABEL[s].text}
          </button>
        ))}
      </div>
      <div className="meta" style={{ marginTop: 4 }}>
        {STATUS_LABEL[t.status].help}.
      </div>
      <div className="field-row" style={{ marginTop: 10 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="tk-priority">Priority</label>
          <select
            id="tk-priority"
            value={t.priority}
            disabled={busy}
            onChange={(e) => update.mutate({ priority: e.target.value as TicketPriority })}
          >
            {(Object.keys(PRIORITY_LABEL) as TicketPriority[]).map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="tk-assign">Assigned to</label>
          {isAdmin && staff.data ? (
            <select
              id="tk-assign"
              value={t.assigned_to ?? ''}
              disabled={busy}
              onChange={(e) => update.mutate({ assigned_to: e.target.value || null })}
            >
              <option value="">Nobody</option>
              {staff.data
                .filter((s) => s.roles.some((r) => r === 'support' || r === 'admin' || r === 'super_admin'))
                .map((s) => (
                  <option key={s.user_id} value={s.user_id}>
                    {s.user_id === me ? 'Me' : (s.full_name ?? s.email)}
                  </option>
                ))}
            </select>
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', paddingTop: 6 }}>
              <span style={{ fontSize: 13 }}>
                {t.assigned_to == null ? 'Nobody' : t.assigned_to === me ? 'You' : 'Someone else'}
              </span>
              {t.assigned_to !== me && (
                <button
                  className="btn small secondary"
                  disabled={busy || !me}
                  onClick={() => update.mutate({ assigned_to: me ?? null })}
                >
                  Assign to me
                </button>
              )}
              {t.assigned_to != null && (
                <button
                  className="btn small secondary"
                  disabled={busy}
                  onClick={() => update.mutate({ assigned_to: null })}
                >
                  Unassign
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ReplyForm({ ticket: t }: { ticket: SupportTicket }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [body, setBody] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState('');

  const send = useMutation({
    mutationFn: (text: string) => postReply(t.id, text, image),
    onSuccess: () => {
      setBody('');
      setImage(null);
      invalidate(...SUP_KEYS);
      toast('Reply sent');
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const text = body.trim();
    if (!text) return setError('Write your reply first.');
    send.mutate(text.slice(0, 4000));
  };

  return (
    <form className="form-card" onSubmit={submit} style={{ marginTop: 14 }}>
      <div className="field">
        <label htmlFor="tk-reply">Reply</label>
        <textarea
          id="tk-reply"
          value={body}
          maxLength={4000}
          placeholder="Hi! Thanks for writing to us…"
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="hint">
          They get a notification. The ticket moves to Waiting until they answer.
          {t.status === 'closed' ? ' Replying reopens this closed ticket as Waiting.' : ''}
        </div>
      </div>
      <ImageField
        label="Screenshot (optional)"
        folder="support"
        aspect="16 / 9"
        value={image}
        onChange={setImage}
      />
      {error && <p className="error-text">{error}</p>}
      <div className="btn-row">
        <button className="btn" type="submit" disabled={send.isPending}>
          {send.isPending ? 'Sending…' : 'Send reply'}
        </button>
      </div>
    </form>
  );
}
