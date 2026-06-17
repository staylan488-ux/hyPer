// DEV-ONLY preview gallery. Landing page that turns on preview mode and links
// into the real signed-in routes (now backed by mock data).
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

const screens: { to: string; index: string; label: string; sub: string }[] = [
  { to: '/', index: '01', label: 'Today', sub: 'Dashboard — hero data, fuel, contents' },
  { to: '/train', index: '02', label: 'Train', sub: 'In-session set ledger + rest timer' },
  { to: '/nutrition', index: '03', label: 'Fuel', sub: 'Macros as hero numerals + timeline' },
  { to: '/train/program', index: '04', label: 'Program', sub: 'Split manager + builder' },
  { to: '/history', index: '05', label: 'History', sub: 'Calendar + past session ledger' },
  { to: '/analysis', index: '06', label: 'Progress', sub: 'Volume landmarks + charts' },
  { to: '/settings', index: '07', label: 'You', sub: 'Profile, targets, theme toggle' },
];

export function PreviewGallery() {
  return (
    <div className="min-h-screen bg-[var(--color-base)] px-7 py-14">
      <div className="w-full max-w-[26rem] mx-auto">
        <header>
          <div className="flex items-baseline justify-between">
            <span className="t-label-sm">Preview mode</span>
            <span className="t-label-sm">Mock data</span>
          </div>
          <div className="border-t border-[var(--color-text)] mt-3 pt-6">
            <h1 className="[font-family:var(--font-display)] text-[3.25rem] leading-[0.9] font-light tracking-[-0.04em] text-[var(--color-text)]">
              The <span className="italic text-[var(--color-accent)]">edition</span>
            </h1>
            <p className="t-display-italic text-[var(--color-text-dim)] text-lg mt-4 max-w-[26ch]">
              Every signed-in screen, no login required.
            </p>
          </div>
        </header>

        <nav className="mt-10">
          <span className="t-label block mb-3">Screens</span>
          <ul>
            {screens.map((s) => (
              <li key={s.to}>
                <Link to={s.to} className="pressable group flex items-center gap-4 py-4 border-t border-[var(--color-border)]">
                  <span className="t-data-sm text-[var(--color-muted)] w-6">{s.index}</span>
                  <span className="flex-1 min-w-0">
                    <span className="t-heading block">{s.label}</span>
                    <span className="t-caption">{s.sub}</span>
                  </span>
                  <ArrowRight className="w-4 h-4 text-[var(--color-muted)] group-hover:text-[var(--color-text)] transition-colors" strokeWidth={1.5} />
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <p className="mt-10 pt-6 border-t border-[var(--color-border)] t-caption max-w-[34ch]">
          Use the bottom navigation to move between sections. Data is sample-only — actions
          (logging, editing) are stubbed and won't persist.
        </p>
      </div>
    </div>
  );
}
