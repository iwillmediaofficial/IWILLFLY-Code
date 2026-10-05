import { AppShell, LogoHeader } from '../../components/AppShell';
import { CampaignPrizes, ScratchButton, ScratchModal } from '../../components/Scratch';
import { useScratchToday } from '../../lib/scratch';
import type { TodayCampaign } from '../../lib/types';
import { useScratchCard } from '../scratch';
import { ErrorNotice } from '../ui';

export default function Scratch() {
  const today = useScratchToday();
  const campaigns = today.data ?? [];
  const showHow = () => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' });
  return (
    <AppShell
      header={
        <LogoHeader
          actions={
            <button className="icon-btn" onClick={showHow} aria-label="How it works">
              ?
            </button>
          }
        />
      }
    >
      <section className="hero">
        <h1>Daily Scratch & Win 🎁</h1>
        <p>
          Play once each day during active shop hours. Once the result is revealed, the daily button changes
          to red until the next day.
        </p>
        <span className="hero-pill">One free chance every day</span>
      </section>
      {today.error && (
        <section className="section">
          <ErrorNotice error={today.error} onRetry={() => today.refetch()} />
        </section>
      )}
      {campaigns.length ? (
        campaigns.map((c) => (
          <CampaignSection key={c.id} campaign={c} many={campaigns.length > 1} onRules={showHow} />
        ))
      ) : (
        <EmptyCampaign loading={today.isLoading} />
      )}
      <section className="section form-card" id="how-it-works">
        <h3 style={{ marginTop: 0 }}>How it works</h3>
        <div className="meta" style={{ lineHeight: 1.8 }}>
          1. Visit a participating nearby shop.
          <br />
          2. Open IWILLFLY during the game’s active time.
          <br />
          3. Scratch once for the day.
          <br />
          4. If you win, show your claim code from My Prizes at the sponsor shop.
          <br />
          5. The button turns red after the daily chance is used.
        </div>
      </section>
    </AppShell>
  );
}

function EmptyCampaign({ loading }: { loading: boolean }) {
  const card = useScratchCard(undefined, loading);
  return (
    <section className="section">
      <ScratchButton card={card} style={{ width: '100%', minHeight: 180 }} />
    </section>
  );
}

function CampaignSection({
  campaign,
  many,
  onRules,
}: {
  campaign: TodayCampaign;
  many: boolean;
  onRules: () => void;
}) {
  const card = useScratchCard(campaign);
  return (
    <>
      <section className="section">
        {many && (
          <div className="section-head">
            <h2>{campaign.name}</h2>
          </div>
        )}
        {campaign.description && (
          <div className="meta" style={{ marginBottom: 10 }}>
            {campaign.description}
          </div>
        )}
        <ScratchButton card={card} style={{ width: '100%', minHeight: 180 }} />
      </section>
      <section className="section">
        <div className="section-head">
          <h2>Today’s possible prizes</h2>
          <button onClick={onRules}>Rules</button>
        </div>
        <CampaignPrizes campaignId={campaign.id} />
      </section>
      <ScratchModal card={card} title="Scratch today’s card" subtitle="Scratch the silver card to reveal">
        <CampaignPrizes campaignId={campaign.id} limit={3} />
      </ScratchModal>
    </>
  );
}
