import type { ReactNode } from 'react';

export function Loading({ what = 'Loading…' }: { what?: string }) {
  return <p className="meta">{what}</p>;
}

export function ErrorNotice({ error }: { error: unknown }) {
  return (
    <div className="notice bad">
      Could not load this. {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

export function Empty({ emoji, title, children }: { emoji: string; title: string; children?: ReactNode }) {
  return (
    <div className="saved-empty">
      <div className="emoji">{emoji}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
