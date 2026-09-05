import { useLayoutEffect, useRef, useState } from 'react';
import { markIntroPlayed, shouldPlayIntro, type IntroVariant } from './introState';
import { playBrandIntro } from './brandIntro';
import './brand-intro.css';

interface BrandWordmarkProps {
  variant: IntroVariant;
  /** Used only by the development preview; never changes production timing. */
  preview?: { duration: number; pauseAt?: number };
}

/** The intro lands on this exact wordmark, with no replacement glyph or font jump. */
export function BrandWordmark({ variant, preview }: BrandWordmarkProps) {
  const target = useRef<HTMLSpanElement>(null);
  const [eligible] = useState(() => shouldPlayIntro(variant));
  const previewDuration = import.meta.env.DEV ? preview?.duration : undefined;
  const previewPauseAt = import.meta.env.DEV ? preview?.pauseAt : undefined;

  useLayoutEffect(() => {
    const anchor = target.current;
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!anchor || motionPreference.matches || (!eligible && !previewDuration)) return;

    // Eligibility is captured before commit, so StrictMode's setup/cleanup/setup
    // cycle can restart the animation without consuming a second session intro.
    if (!previewDuration) markIntroPlayed(variant);
    return playBrandIntro(anchor, motionPreference, {
      duration: previewDuration,
      pauseAt: previewPauseAt,
    });
  }, [eligible, variant, previewDuration, previewPauseAt]);

  return (
    <span ref={target} className={`brand-wordmark brand-wordmark--${variant}`} aria-label="hyPer">
      <span className="brand-wordmark__side" aria-hidden>hy</span>
      <span className="brand-wordmark__p" aria-hidden>P</span>
      <span className="brand-wordmark__side" aria-hidden>er</span>
    </span>
  );
}
