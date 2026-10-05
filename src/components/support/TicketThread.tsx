import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { ErrorNotice, Loading } from '../../customer/ui';
import { mediaUrl } from '../../lib/supabase';
import type { SupportTicket, TicketMessage } from '../../lib/types';
import { ImageField } from '../ImageField';
import { EmptyState } from '../ShopCard';
import { useToast } from '../Toast';
import {
  categoryLabel,
  formatWhen,
  statusClass,
  statusHint,
  statusLabel,
  useCanUpload,
  useCloseTicket,
  usePostMessage,
  useTicket,
  type SupportScope,
} from './api';

const errorText = (e: unknown) =>
  e instanceof Error ? e.message : 'Something went wrong. Please try again.';

/** One ticket (id from the route) with its messages, a reply box and a Close button. */
export function TicketThread({ scope }: { scope: SupportScope }) {
  const id = Number(useParams().id);
  const { data, isPending, error, refetch } = useTicket(scope, id);
  const back = (
    <div className="section-head">
      <h2>Ticket</h2>
      <Link to={scope.basePath}>All tickets</Link>
    </div>
  );
  if (isPending) return <Loading text="Loading ticket…" />;
  if (error)
    return (
      <>
        {back}
        <ErrorNotice error={error} onRetry={() => refetch()} />
      </>
    );
  if (!data.ticket)
    return (
      <>
        {back}
        <EmptyState emoji="🔎" title="Ticket not found" text="It may belong to another account." />
      </>
    );
  return (
    <>
      {back}
      <Thread key={data.ticket.id} scope={scope} ticket={data.ticket} messages={data.messages} />
    </>
  );
}

function Thread({
  scope,
  ticket: t,
  messages,
}: {
  scope: SupportScope;
  ticket: SupportTicket;
  messages: TicketMessage[];
}) {
  const { session } = useAuth();
  const toast = useToast();
  const close = useCloseTicket(scope, t.id);
  const me = session?.user.id;

  const onClose = () => {
    if (!confirm('Close this ticket? You can reply later to open it again.')) return;
    close.mutate(undefined, {
      onSuccess: () => toast('Ticket closed'),
      onError: (e) => toast(errorText(e)),
    });
  };

  return (
    <>
      <div className="manage-card" style={{ marginBottom: 12 }}>
        <h4 style={{ overflowWrap: 'anywhere' }}>{t.subject}</h4>
        <div className="meta">
          {categoryLabel[t.category]} · #{t.id} · Opened {formatWhen(t.created_at)}
        </div>
        <div style={{ marginTop: 6 }}>
          <span className={`pill-status ${statusClass[t.status]}`}>{statusLabel[t.status]}</span>
        </div>
        <div className="meta" style={{ marginTop: 6 }}>
          {statusHint[t.status]}
        </div>
      </div>

      <div className="list">
        {messages.map((m) => (
          <Message key={m.id} message={m} mine={m.author_id === me} />
        ))}
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Reply</h2>
        </div>
        <ReplyForm scope={scope} ticket={t} />
        {t.status !== 'closed' && (
          <div className="btn-row">
            <button
              type="button"
              className="btn secondary small"
              disabled={close.isPending}
              onClick={onClose}
            >
              {close.isPending ? 'Closing…' : 'Close ticket'}
            </button>
          </div>
        )}
      </section>
    </>
  );
}

function Message({ message: m, mine }: { message: TicketMessage; mine: boolean }) {
  const who = m.is_staff ? 'IWILLFLY support' : mine ? 'You' : 'Your team';
  return (
    <div
      className="manage-card"
      style={{
        marginTop: 0,
        background: m.is_staff ? 'var(--color-blue-soft)' : '#fff',
        borderColor: m.is_staff ? '#cfe0ff' : undefined,
        marginLeft: m.is_staff ? 0 : 24,
        marginRight: m.is_staff ? 24 : 0,
      }}
    >
      <div className="meta" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <b style={{ color: m.is_staff ? 'var(--color-blue)' : 'var(--color-ink)' }}>
          {m.is_staff ? '🛟 ' : ''}
          {who}
        </b>
        <span>{formatWhen(m.created_at)}</span>
      </div>
      <p
        style={{
          fontSize: 14,
          lineHeight: 1.5,
          margin: '6px 0 0',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}
      >
        {m.body}
      </p>
      {m.image_key && (
        <a href={mediaUrl(m.image_key)} target="_blank" rel="noreferrer">
          <img
            src={mediaUrl(m.image_key)}
            alt="Attached screenshot"
            loading="lazy"
            style={{ display: 'block', maxWidth: '100%', maxHeight: 320, borderRadius: 12, marginTop: 8 }}
          />
        </a>
      )}
    </div>
  );
}

function ReplyForm({ scope, ticket: t }: { scope: SupportScope; ticket: SupportTicket }) {
  const toast = useToast();
  const canUpload = useCanUpload();
  const post = usePostMessage(scope, t.id);
  const [body, setBody] = useState('');
  const [imageKey, setImageKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const reopens = t.status === 'closed' || t.status === 'resolved';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const b = body.trim();
    const problem = !b
      ? 'Write your reply.'
      : b.length > 4000
        ? 'Reply is too long (4000 characters max).'
        : null;
    setError(problem ?? '');
    if (problem) return;
    post.mutate(
      { body: b, imageKey },
      {
        onSuccess: () => {
          toast(reopens ? 'Reply sent and ticket reopened' : 'Reply sent');
          setBody('');
          setImageKey(null);
        },
        onError: (err) => setError(errorText(err)),
      },
    );
  };

  return (
    <form className="form-card" onSubmit={submit} noValidate>
      {reopens && <div className="notice">Sending a reply opens this ticket again.</div>}
      <div className="field">
        <label htmlFor="t-reply">Your message</label>
        <textarea
          id="t-reply"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={4000}
          placeholder="Write a reply to IWILLFLY support"
        />
      </div>
      {canUpload && (
        <ImageField
          label="Screenshot (optional)"
          value={imageKey}
          folder="support"
          onChange={setImageKey}
          aspect="16 / 9"
        />
      )}
      {error && <p className="error-text">{error}</p>}
      <button className="btn block" type="submit" disabled={post.isPending} style={{ marginTop: 8 }}>
        {post.isPending ? 'Sending…' : 'Send reply'}
      </button>
    </form>
  );
}
