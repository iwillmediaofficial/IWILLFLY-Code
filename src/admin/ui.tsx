import type { ReactNode } from 'react';
import { EmptyArt, type LucideIcon } from '../components/Icon';

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

export function Empty({
  icon,
  title,
  children,
}: {
  icon: LucideIcon | string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="saved-empty">
      <EmptyArt icon={icon} />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
