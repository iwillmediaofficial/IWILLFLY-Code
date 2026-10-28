import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useUnreadCount } from '../lib/engagement';

export function AppShell({ children, header }: { children: ReactNode; header: ReactNode }) {
  return (
    <div className="app-shell">
      {header}
      <main className="page">{children}</main>
      <BottomNav />
    </div>
  );
}

/** Blue gradient header with the logo, matching the prototype. */
export function LogoHeader({ actions, children }: { actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="topbar">
      <div className="top-row">
        <Link to="/" style={{ display: 'flex' }}>
          <img
            className="logo"
            src="/iwillfly-logo.webp"
            alt="IWILLFLY"
            width={132}
            height={44}
            fetchPriority="high"
          />
        </Link>
        <div className="grow" />
        {actions}
      </div>
      {children}
    </header>
  );
}

/** Header bell linking to the inbox, with an unread badge for signed-in users. */
export function NotificationBell() {
  const { session } = useAuth();
  const { data: unread = 0 } = useUnreadCount();
  const count = session ? unread : 0;
  return (
    <Link
      className="icon-btn bell-btn"
      to="/notifications"
      aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
    >
      🔔
      {count > 0 && <span className="bell-badge">{count > 9 ? '9+' : count}</span>}
    </Link>
  );
}

/** Header with a back button and a title, used on detail pages. */
export function BackHeader({
  back,
  title,
  subtitle,
  actions,
}: {
  back: string;
  title: string;
  subtitle: string;
  actions?: ReactNode;
}) {
  return (
    <header className="topbar">
      <div className="top-row">
        <Link className="icon-btn" to={back} aria-label="Back">
          ‹
        </Link>
        <div>
          <b>{title}</b>
          <div style={{ fontSize: 11, opacity: 0.8 }}>{subtitle}</div>
        </div>
        <div className="grow" />
        {actions}
      </div>
    </header>
  );
}

/** Line icons drawn as SVG so every one is the same size and weight on every phone. */
function NavIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const navItems: { to: string; icon: ReactNode; label: string; end?: boolean; scratch?: boolean }[] = [
  {
    to: '/',
    icon: (
      <NavIcon>
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
      </NavIcon>
    ),
    label: 'Home',
    end: true,
  },
  {
    to: '/explore',
    icon: (
      <NavIcon>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </NavIcon>
    ),
    label: 'Explore',
  },
  { to: '/scratch', icon: '🎁', label: 'Scratch', scratch: true },
  {
    to: '/saved',
    icon: (
      <NavIcon>
        <path d="M12 20.5s-7.5-4.6-9.2-9.3C1.7 8 3.8 4.5 7.3 4.5c2 0 3.6 1.1 4.7 2.7 1.1-1.6 2.7-2.7 4.7-2.7 3.5 0 5.6 3.5 4.5 6.7-1.7 4.7-9.2 9.3-9.2 9.3Z" />
      </NavIcon>
    ),
    label: 'Saved',
  },
  {
    to: '/profile',
    icon: (
      <NavIcon>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
      </NavIcon>
    ),
    label: 'Profile',
  },
];

/** Only for signed-in users: every page it links to needs a sign-in. */
export function BottomNav() {
  const { session } = useAuth();
  if (!session) return null;
  return (
    <nav className="bottom-nav">
      {navItems.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          className={({ isActive }) => `nav-item${n.scratch ? ' scratch' : ''}${isActive ? ' active' : ''}`}
        >
          <i>{n.icon}</i>
          {n.label}
        </NavLink>
      ))}
    </nav>
  );
}
