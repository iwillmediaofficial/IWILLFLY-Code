import { Link } from 'react-router-dom';
import { ErrorNotice, Loading } from '../../customer/ui';
import { EmptyState } from '../ShopCard';
import { categoryLabel, formatWhen, statusClass, statusLabel, useTickets, type SupportScope } from './api';

/** The signed-in person's (or business's) support tickets, newest activity first. */
export function TicketList({ scope }: { scope: SupportScope }) {
  const { data, isPending, error, refetch } = useTickets(scope);
  const newLink = (
    <Link className="btn" to={`${scope.basePath}/new`} style={{ display: 'inline-block', marginTop: 12 }}>
      ＋ New ticket
    </Link>
  );

  return (
    <>
      <div className="section-head">
        <h2>Help & support</h2>
        <Link to={`${scope.basePath}/new`}>＋ New ticket</Link>
      </div>
      <div className="notice">
        Ask the IWILLFLY team anything{scope.forBusiness ? ' about your business, plan or offers' : ''}. We
        reply here and send you an alert.
      </div>
      {isPending ? (
        <Loading text="Loading your tickets…" />
      ) : error ? (
        <ErrorNotice error={error} onRetry={() => refetch()} />
      ) : data.length === 0 ? (
        <EmptyState
          emoji="💬"
          title="No tickets yet"
          text="Questions you send to IWILLFLY support show up here."
        >
          {newLink}
        </EmptyState>
      ) : (
        <div className="list">
          {data.map((t) => {
            const fresh = t.last_from_staff && t.status === 'waiting';
            return (
              <Link
                key={t.id}
                to={`${scope.basePath}/${t.id}`}
                className="manage-card"
                style={{
                  marginTop: 0,
                  display: 'block',
                  borderColor: fresh ? 'var(--color-blue)' : undefined,
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h4 style={{ overflowWrap: 'anywhere' }}>{t.subject}</h4>
                    <div className="meta">
                      {categoryLabel[t.category]} · Updated {formatWhen(t.last_message_at)}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      <span className={`pill-status ${statusClass[t.status]}`}>{statusLabel[t.status]}</span>
                      {fresh && (
                        <span
                          className="pill-status"
                          style={{ background: 'var(--color-blue)', color: '#fff' }}
                        >
                          New reply
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="chev">›</div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
