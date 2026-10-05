import { useEffect, useState } from 'react';

const ads = [
  {
    cls: 'ad1',
    pill: 'MAIN FESTIVAL OFFER',
    title: ['Celebrate Local.', 'Save More.'],
    text: 'Big festive offers from your favourite stores.',
  },
  {
    cls: 'ad2',
    pill: 'MALL DAYS',
    title: ['One mall.', 'Many offers.'],
    text: 'Browse stores inside leading malls.',
  },
  {
    cls: 'ad3',
    pill: 'MEGA TEXTILE WEEK',
    title: ['Style Deals', 'Near You.'],
    text: 'Special offers from Kerala’s popular textile stores.',
  },
];

export function AdSlider() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setI((x) => (x + 1) % ads.length), 3500);
    return () => window.clearInterval(t);
  }, []);
  return (
    <section className="ad-slider">
      <div className="ad-track" style={{ transform: `translateX(-${i * 100}%)` }}>
        {ads.map((a) => (
          <div key={a.cls} className={`ad ${a.cls}`}>
            <span className="pill">{a.pill}</span>
            <h3>
              {a.title[0]}
              <br />
              {a.title[1]}
            </h3>
            <p>{a.text}</p>
          </div>
        ))}
      </div>
      <div className="dots">
        {ads.map((a, x) => (
          <i key={a.cls} className={`dot${x === i ? ' active' : ''}`} />
        ))}
      </div>
    </section>
  );
}
