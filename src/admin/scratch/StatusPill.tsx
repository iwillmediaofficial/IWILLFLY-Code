import type { CampaignStatus } from './api';

const LABEL: Record<CampaignStatus, { text: string; cls: string }> = {
  live: { text: 'Live', cls: 'live' },
  scheduled: { text: 'Scheduled', cls: 'pending' },
  ended: { text: 'Ended', cls: 'rejected' },
  off: { text: 'Off', cls: '' },
};

export function StatusPill({ status }: { status: CampaignStatus }) {
  const s = LABEL[status];
  return <span className={`pill-status ${s.cls}`}>{s.text}</span>;
}
