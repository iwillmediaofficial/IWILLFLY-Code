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
          <img className="logo" src="/iwillfly-logo.jpg" alt="IWILLFLY" />
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

const navItems = [
  { to: '/', icon: '⌂', label: 'Home', end: true },
  { to: '/explore', icon: '⌕', label: 'Explore' },
  { to: '/scratch', icon: '🎁', label: 'Scratch', scratch: true },
  { to: '/saved', icon: '♡', label: 'Saved' },
  { to: '/profile', icon: '◯', label: 'Profile' },
];

export function BottomNav() {
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
