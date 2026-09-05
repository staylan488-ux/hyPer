// DEV-ONLY: replay and inspect the actual intro without signing out or changing data.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BrandWordmark } from '@/components/intro/BrandWordmark';
import type { IntroVariant } from '@/components/intro/introState';
import { Button, ThemeToggle } from '@/components/shared';

export function IntroPreview() {
  const [run, setRun] = useState(0);
  const [variant, setVariant] = useState<IntroVariant>('dashboard');
  const [pauseAt, setPauseAt] = useState<number>();

  return (
    <div className="min-h-screen px-6 pt-7 pb-10 max-w-lg mx-auto">
      <header className={variant === 'login' ? 'pt-20' : ''}>
        <BrandWordmark key={`${run}-${variant}`} variant={variant} preview={{ duration: 1800, pauseAt }} />
        <p className="t-label mt-5">{variant === 'dashboard' ? 'Today' : 'A field journal'}</p>
      </header>
      <section className="mt-12">
        <h1 className="t-title">The opening note.</h1>
        <p className="t-caption mt-4">A single P becomes hyPer, then settles into the page. Tap or press any key to skip. Your system’s reduced-motion preference takes priority.</p>
        <div className="flex flex-wrap gap-3 mt-8">
          <Button onClick={() => { setPauseAt(undefined); setRun((n) => n + 1); }}>Replay intro</Button>
          <Button variant="secondary" onClick={() => { setPauseAt(undefined); setVariant((v) => v === 'dashboard' ? 'login' : 'dashboard'); }}>
            {variant === 'dashboard' ? 'Show sign-in version' : 'Show dashboard version'}
          </Button>
        </div>
        <div className="mt-8 pt-5 border-t border-[var(--color-border)]">
          <p className="t-label mb-3">Inspect a frame</p>
          <div className="flex flex-wrap gap-2">
            {[{ label: 'P', value: .18 }, { label: 'Compose', value: .49 }, { label: 'Land', value: .94 }].map(({ label, value }) => (
              <Button key={label} variant="secondary" onClick={() => { setPauseAt(value); setRun((n) => n + 1); }}>{label}</Button>
            ))}
          </div>
        </div>
        <div className="mt-8"><ThemeToggle /></div>
        <Link to="/preview" className="t-caption min-h-11 flex items-center mt-6">Back to all screens →</Link>
      </section>
    </div>
  );
}
