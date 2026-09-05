// DEV-ONLY: replay and inspect the actual intro without signing out or changing data.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { BrandWordmark } from '@/components/intro/BrandWordmark';
import type { IntroVariant } from '@/components/intro/introState';
import { Button, Screen, ThemeToggle } from '@/components/shared';
import { useAppViewport } from '@/hooks/useAppViewport';

export function IntroPreview() {
  const [run, setRun] = useState(0);
  const [variant, setVariant] = useState<IntroVariant>('dashboard');
  const [pauseAt, setPauseAt] = useState<number>();
  const [lateInset, setLateInset] = useState(false);
  const [safeTop, setSafeTop] = useState(0);
  const viewport = useRef<HTMLElement>(null);
  const pendingReplay = useRef<number | null>(null);
  useAppViewport();

  useEffect(() => () => {
    if (pendingReplay.current !== null) window.cancelAnimationFrame(pendingReplay.current);
  }, []);

  useEffect(() => {
    if (!lateInset) return;
    // Reproduce WKWebView resolving its notch inset after the intro measured
    // its destination. This stays local to the preview's actual app shell.
    const timer = window.setTimeout(() => setSafeTop(62), 1200);
    return () => window.clearTimeout(timer);
  }, [run, lateInset]);

  const replay = (frame?: number, withLateInset = false, nextVariant = variant) => {
    if (pendingReplay.current !== null) window.cancelAnimationFrame(pendingReplay.current);
    const begin = () => {
      pendingReplay.current = null;
      setVariant(nextVariant);
      setPauseAt(frame);
      setLateInset(withLateInset);
      setSafeTop(0);
      setRun((n) => n + 1);
    };
    if (viewport.current && viewport.current.scrollTop !== 0) {
      // Keep the masthead visible after reaching controls on a small screen.
      // Let the reset's scroll event finish before installing the intro's skip
      // listener, otherwise the harness would immediately dismiss its replay.
      viewport.current.scrollTop = 0;
      pendingReplay.current = window.requestAnimationFrame(begin);
    } else {
      begin();
    }
  };

  const content = (
    <>
      <header data-intro-preview-anchor className={variant === 'login' ? 'pt-20' : ''}>
        <BrandWordmark key={`${run}-${variant}`} variant={variant} preview={{ duration: 1800, pauseAt }} />
        <p className="t-label mt-5">{variant === 'dashboard' ? 'Today' : 'A field journal'}</p>
      </header>
      <section className="mt-12">
        <h1 className="t-title">The opening note.</h1>
        <p className="t-caption mt-4">A single P becomes hyPer, then settles into the page. Tap or press any key to skip. Your system’s reduced-motion preference takes priority.</p>
        <div className="flex flex-wrap gap-3 mt-8">
          <Button onClick={() => replay()}>Replay intro</Button>
          <Button variant="secondary" onClick={() => replay(undefined, false, variant === 'dashboard' ? 'login' : 'dashboard')}>
            {variant === 'dashboard' ? 'Show sign-in version' : 'Show dashboard version'}
          </Button>
        </div>
        <div className="mt-8 pt-5 border-t border-[var(--color-border)]">
          <p className="t-label mb-3">Inspect a frame</p>
          <div className="flex flex-wrap gap-2">
            {[{ label: 'P', value: .18 }, { label: 'Compose', value: .49 }, { label: 'Land', value: .94 }, { label: 'Final frame', value: .999 }].map(({ label, value }) => (
              <Button key={label} variant="secondary" onClick={() => replay(value)}>{label}</Button>
            ))}
          </div>
        </div>
        {variant === 'dashboard' && (
          <div className="mt-8 pt-5 border-t border-[var(--color-border)]">
            <p className="t-label mb-3">Late notch inset</p>
            <p className="t-caption mb-4">The shell gains 62px of top clearance during landing. The wordmark should settle into the masthead without a jump.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => replay(undefined, true)}>Replay with late inset</Button>
              <Button variant="secondary" onClick={() => replay(.999, true)}>Inspect late landing</Button>
            </div>
            {lateInset && <p className="t-caption mt-3">Preview top inset: {safeTop}px</p>}
          </div>
        )}
        <div className="mt-8"><ThemeToggle /></div>
        <Link to="/preview" className="t-caption min-h-11 flex items-center mt-6">Back to all screens →</Link>
      </section>
    </>
  );

  if (variant === 'dashboard') {
    return (
      <div
        className="app-viewport"
        data-intro-preview-shell
        data-intro-preview-scenario={lateInset ? 'late-inset' : 'native-inset'}
        style={lateInset ? { '--app-safe-top': `${safeTop}px` } as CSSProperties : undefined}
      >
        <main ref={viewport} data-app-scroll-viewport className="app-scroll-viewport">
          <Screen>{content}</Screen>
        </main>
      </div>
    );
  }

  return (
    <div className="material-foundation min-h-screen" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <div className="px-6 pt-7 pb-10 max-w-lg mx-auto">{content}</div>
    </div>
  );
}
