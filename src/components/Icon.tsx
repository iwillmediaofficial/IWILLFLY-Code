import type { LucideIcon, LucideProps } from 'lucide-react';

export type { LucideIcon };

/**
 * A line icon drawn like the bottom-nav icons (24px grid, 2px round stroke, current text colour).
 * Sized to the surrounding text by default; decorative, so screen readers skip it.
 */
export function Icon({
  icon: Glyph,
  size = '1em',
  className,
  ...rest
}: Omit<LucideProps, 'ref'> & { icon: LucideIcon }) {
  return (
    <Glyph
      size={size}
      strokeWidth={2}
      aria-hidden="true"
      focusable="false"
      className={className ? `lic ${className}` : 'lic'}
      {...rest}
    />
  );
}

/** A large line icon in a soft round circle, used by empty states. */
export function IconBubble({ icon }: { icon: LucideIcon }) {
  return (
    <div className="ico-bubble">
      <Icon icon={icon} size={40} />
    </div>
  );
}

/** The save heart, the same shape as the bottom-nav Saved icon: an outline, filled red once saved. */
export function SaveHeart({ saved }: { saved: boolean }) {
  return (
    <svg
      className={`lic save-heart${saved ? ' on' : ''}`}
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill={saved ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 20.5s-7.5-4.6-9.2-9.3C1.7 8 3.8 4.5 7.3 4.5c2 0 3.6 1.1 4.7 2.7 1.1-1.6 2.7-2.7 4.7-2.7 3.5 0 5.6 3.5 4.5 6.7-1.7 4.7-9.2 9.3-9.2 9.3Z" />
    </svg>
  );
}

/** An empty state's picture: a line icon in a circle, or a kept celebration emoji (festivals). */
export function EmptyArt({ icon }: { icon: LucideIcon | string }) {
  return typeof icon === 'string' ? <div className="emoji">{icon}</div> : <IconBubble icon={icon} />;
}
