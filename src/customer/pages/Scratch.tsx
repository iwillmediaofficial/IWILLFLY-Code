import { AppShell, LogoHeader } from '../../components/AppShell';
import { PrizeGrid, ScratchButton, ScratchModal, useDailyScratch } from '../../components/Scratch';

export default function Scratch() {
  const daily = useDailyScratch();
  return (
    <AppShell header={<LogoHeader actions={<button className="icon-btn">?</button>} />}>
      <section className="hero">
        <h1>Daily Scratch & Win 🎁</h1>
        <p>
          Play once each day during active shop hours. Once the result is revealed, the daily button changes
          to red until the next day.
        </p>
        <span className="hero-pill">Daily reward system demo</span>
      </section>
      <section className="section">
        <ScratchButton daily={daily} style={{ width: '100%', minHeight: 180 }} />
      </section>
      <section className="section">
        <div className="section-head">
          <h2>Today’s possible prizes</h2>
          <button>Rules</button>
        </div>
        <PrizeGrid
          items={[
            ['📱', 'Smart Phone'],
            ['💻', 'Laptop'],
            ['🧺', 'Washing Machine'],
            ['🎧', 'Earbuds'],
            ['🎫', 'Shopping Voucher'],
            ['🎁', 'Mystery Gift'],
          ]}
        />
      </section>
      <section className="section form-card">
        <h3 style={{ marginTop: 0 }}>How it works</h3>
        <div className="meta" style={{ lineHeight: 1.8 }}>
          1. Visit a participating nearby shop.
          <br />
          2. Open IWILLFLY during the shop’s active time.
          <br />
          3. Scratch once for the day.
          <br />
          4. If you win, show the result screen at the selected shop.
          <br />
          5. The button turns red after the daily chance is used.
        </div>
      </section>
      <ScratchModal daily={daily} title="Scratch today’s card" subtitle="Tap the silver card to reveal">
        <PrizeGrid
          items={[
            ['📱', 'Phone'],
            ['⌚', 'Watch'],
            ['🎧', 'Earbuds'],
          ]}
        />
      </ScratchModal>
    </AppShell>
  );
}
