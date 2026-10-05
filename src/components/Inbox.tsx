import { Link } from 'react-router-dom';
import { useMarkRead, useNotifications } from '../lib/engagement';

function when(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** The signed-in user's messages; tapping one marks it read and opens its link. */
export function Inbox() {
  const { data, isPending, error } = useNotifications();
  const markRead = useMarkRead();
  if (isPending) return <p style={{ color: 'var(--color-muted)' }}>Loading…</p>;
  if (error) return <div className="notice">{error.message}</div>;
  if (!data.length)
    return (
      <p style={{ color: 'var(--color-muted)' }}>
        No messages yet. Offers, prizes and updates will show up here.
      </p>
    );
  const unread = data.some((n) => !n.read_at);
  return (
    <div>
      {unread && (
        <button className="link-btn" style={{ marginBottom: 8 }} onClick={() => markRead.mutate(undefined)}>
          Mark all as read
        </button>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {data.map((n) => {
          const body = (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <b style={{ fontSize: 14 }}>{n.title}</b>
                <span style={{ fontSize: 11, flex: 'none', color: 'var(--color-muted)' }}>
                  {when(n.created_at)}
                </span>
              </div>
              {n.body && <div style={{ fontSize: 13, marginTop: 2 }}>{n.body}</div>}
            </>
          );
          return (
            <li
              key={n.id}
              className="manage-card"
              style={{ borderLeft: n.read_at ? undefined : '4px solid var(--color-blue)' }}
            >
              {n.link ? (
                <Link
                  to={n.link}
                  onClick={() => !n.read_at && markRead.mutate(n.id)}
                  style={{ display: 'block' }}
                >
                  {body}
                </Link>
              ) : (
                <div onClick={() => !n.read_at && markRead.mutate(n.id)}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
