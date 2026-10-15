import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * Metal back link for pushed screens: a quiet 15px text action with a 7×12
 * chevron, like the workout's "‹ Today". 44pt tall; the chevron hangs into
 * the gutter so the label lines up with the page text.
 */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="metal-text-btn is-quiet gap-[5px] -ml-[2px]">
      <svg
        className="w-[7px] h-[12px] flex-none"
        viewBox="0 0 7 12"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M6 1L1 6l5 5" />
      </svg>
      {children}
    </Link>
  );
}
