import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { db, must } from '../../lib/queries';
import type { AuditEntry } from '../../lib/types';
import { Empty, ErrorNotice, Loading } from '../ui';

const PAGE = 50;

/** Audited tables with a plain name for one row. */
const TABLES: Record<string, string> = {
  user_roles: 'staff role',
  vendors: 'vendor',
  shops: 'shop',
  offers: 'offer',
  categories: 'category',
  locations: 'location',
  malls: 'mall',
  mall_shops: 'mall shop link',
  scratch_campaigns: 'Scratch & Win campaign',
  scratch_prizes: 'scratch prize',
  scratch_plays: 'scratch play',
  festivals: 'festival',
  festival_offers: 'festival offer',
  ads: 'home ad',
  placement_requests: 'placement request',
  broadcasts: 'notification',
  billing_settings: 'billing settings',
  plans: 'plan',
  addons: 'add-on',
  invoices: 'invoice',
  subscriptions: 'subscription',
  addon_purchases: 'add-on purchase',
  support_tickets: 'support ticket',
  vendor_staff: 'vendor team member',
  bill_submissions: 'customer bill',
  points_settings: 'points settings',
  redemptions: 'cash-out',
  holidays: 'holiday',
};

const VERB = { insert: 'added', update: 'changed', delete: 'removed' } as const;

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
}

export default function AuditLog() {
  const [table, setTable] = useState('');
  const log = useInfiniteQuery({
    queryKey: ['admin-audit', table],
    initialPageParam: null as number | null,
    queryFn: async ({ pageParam }) =>
      must<AuditEntry[]>(
        await db().rpc('audit_log', {
          p_table: table || null,
          p_actor: null,
          p_before: pageParam,
          p_limit: PAGE,
        }),
      ),
    getNextPageParam: (last) => (last.length < PAGE ? undefined : last[last.length - 1].id),
  });
  const rows = log.data?.pages.flat() ?? [];

  return (
    <>
      <div className="section-head">
        <h2>Audit log</h2>
      </div>
      <div className="notice">
        Every change made by IWILLFLY staff (admins, support and campaign managers), newest first. Changes
        made by vendors, customers and nightly jobs are not listed.
      </div>
      <div className="field">
        <label htmlFor="audit-table">Show</label>
        <select id="audit-table" value={table} onChange={(e) => setTable(e.target.value)}>
          <option value="">Everything</option>
          {Object.entries(TABLES).map(([k, label]) => (
            <option key={k} value={k}>
              {label[0].toUpperCase() + label.slice(1)} ({k})
            </option>
          ))}
        </select>
      </div>
      {log.isPending && <Loading />}
      {log.error && <ErrorNotice error={log.error} />}
      {log.data && rows.length === 0 && <Empty emoji="📜" title="No changes recorded yet" />}
      {rows.map((e) => (
        <Entry key={e.id} entry={e} />
      ))}
      {log.hasNextPage && (
        <div className="btn-row" style={{ justifyContent: 'center' }}>
          <button
            className="btn small secondary"
            disabled={log.isFetchingNextPage}
            onClick={() => log.fetchNextPage()}
          >
            {log.isFetchingNextPage ? 'Loading…' : 'Load older'}
          </button>
        </div>
      )}
    </>
  );
}

function Entry({ entry: e }: { entry: AuditEntry }) {
  const thing = TABLES[e.table_name] ?? e.table_name;
  const when = new Date(e.created_at).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const changes = Object.entries(e.changes ?? {});
  return (
    <div className="manage-card">
      <div className="meta">
        {when} · {e.actor_email ?? 'Unknown user'}
      </div>
      <h4 style={{ marginTop: 4 }}>
        <span
          style={{
            color:
              e.action === 'delete'
                ? 'var(--color-red)'
                : e.action === 'insert'
                  ? 'var(--color-green)'
                  : 'var(--color-ink)',
          }}
        >
          {VERB[e.action][0].toUpperCase() + VERB[e.action].slice(1)}
        </span>{' '}
        {thing}
        {e.row_id && !e.table_name.endsWith('_settings') ? ` #${e.row_id}` : ''}
      </h4>
      {e.action === 'update' ? (
        <div style={{ fontSize: 12, display: 'grid', gap: 2, overflowWrap: 'anywhere' }}>
          {changes.map(([field, pair]) => {
            const [from, to] = Array.isArray(pair) ? pair : [undefined, pair];
            return (
              <div key={field}>
                <b>{field}</b>: <span className="meta">{show(from)}</span> → {show(to)}
              </div>
            );
          })}
        </div>
      ) : (
        <details style={{ fontSize: 12 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--color-blue)', fontWeight: 700 }}>
            {e.action === 'insert' ? 'What was added' : 'What was removed'} ({changes.length} fields)
          </summary>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              background: 'var(--color-bg)',
              borderRadius: 10,
              padding: 8,
              margin: '6px 0 0',
              maxHeight: 300,
              overflow: 'auto',
            }}
          >
            {JSON.stringify(e.changes, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
