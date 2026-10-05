import type { AdStatus, FestivalStatus } from './api';

const LABEL: Record<FestivalStatus | AdStatus, { text: string; cls: string }> = {
  live: { text: 'Live', cls: 'live' },
  running: { text: 'Running', cls: 'live' },
  upcoming: { text: 'Upcoming', cls: 'pending' },
  scheduled: { text: 'Scheduled', cls: 'pending' },
  ended: { text: 'Ended', cls: 'rejected' },
  off: { text: 'Off', cls: '' },
};

export function StatusPill({ status }: { status: FestivalStatus | AdStatus }) {
  const s = LABEL[status];
  return <span className={`pill-status ${s.cls}`}>{s.text}</span>;
}
