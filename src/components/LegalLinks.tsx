import { Link } from 'react-router-dom';

/** Small "Privacy policy · Terms" footer, shown on public pages. */
export function LegalLinks() {
  return (
    <p className="meta legal-links">
      <Link to="/privacy">Privacy policy</Link> · <Link to="/terms">Terms</Link>
    </p>
  );
}
