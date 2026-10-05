import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from './format';

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return (
    <p className="meta" style={{ textAlign: 'center', padding: 24 }}>
      {text}
    </p>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  return <div className="notice bad">Could not load this: {errorMessage(error)}</div>;
}

export function NotFound({ what, back }: { what: string; back: string }) {
  return (
    <div className="saved-empty">
      <div className="emoji">🔎</div>
      <h3>{what} not found</h3>
      <p>It may have been deleted, or it belongs to another account.</p>
      <Link className="btn secondary" to={back} style={{ display: 'inline-block', marginTop: 8 }}>
        Go back
      </Link>
    </div>
  );
}

export function PageHead({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      {action}
    </div>
  );
}

/** Disables every control inside while the vendor is blocked. */
export function Lockable({ locked, children }: { locked: boolean; children: ReactNode }) {
  return (
    <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      {children}
    </fieldset>
  );
}

export function BlockedNote() {
  return (
    <div className="notice bad">
      Your account is blocked, so changes are switched off. See the dashboard for details.
    </div>
  );
}
