import { Link } from 'react-router-dom';
import { festivalBackground, festivalDates, useActiveFestivals } from './engagement';

/** Home-screen banner for each festival running today. Renders nothing otherwise. */
export function FestivalBanners() {
  const { data } = useActiveFestivals();
  if (!data?.length) return null;
  return (
    <section className="section list">
      {data.map((f) => (
        <Link
          key={f.id}
          className="hero festival-banner"
          to={`/festival/${f.slug}`}
          style={festivalBackground(f)}
        >
          <span className="festival-tag">🎉 Festival · {festivalDates(f)}</span>
          <h1>{f.name}</h1>
          {f.description && <p className="festival-desc">{f.description}</p>}
          <span className="hero-pill">See offers →</span>
        </Link>
      ))}
    </section>
  );
}
