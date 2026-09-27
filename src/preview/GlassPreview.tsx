// DEV-ONLY: exercise the native iOS 26 glass surfaces without a workout.
// /preview/glass            rest dock (running) + a toast every few seconds
// /preview/glass?seconds=12 short rest, to see the warning and completion
// /preview/glass?mode=nav   native tab bar + toasts instead of the dock
import { useEffect, useState } from 'react';
import { BottomNav, Screen, Toast } from '@/components/shared';
import { RestTimerPill } from '@/components/workout/RestTimerPill';
import { useAppViewport } from '@/hooks/useAppViewport';
import { useAmbientLight } from '@/hooks/useAmbientLight';

export function GlassPreview() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode') === 'nav' ? 'nav' : 'rest';
  const seconds = Math.max(5, Number(params.get('seconds')) || 90);
  const [toast, setToast] = useState(false);
  const [restKey, setRestKey] = useState(1);
  useAppViewport();
  useAmbientLight();

  useEffect(() => {
    const timer = window.setInterval(() => setToast((shown) => !shown), 2600);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="app-viewport">
      <main data-app-scroll-viewport className="app-scroll-viewport">
        <Screen>
          <p className="t-label-sm">Preview</p>
          <h1 className="t-title mt-3">Native glass</h1>
          <p className="t-body mt-4 text-[var(--color-text-dim)]">
            Scroll this page: content should pass beneath the glass. Rest restarts
            when dismissed.
          </p>
          {Array.from({ length: 14 }, (_, i) => (
            <div key={i} className="mt-6 pt-5 border-t border-[var(--color-border)]">
              <p className="t-heading">Ledger row {i + 1}</p>
              <p className="t-caption mt-1">Barbell Row · 80 × 10 · RPE 7</p>
              <div className="mt-3 h-10 bg-[var(--color-accent)]" style={{ opacity: 0.12 + (i % 4) * 0.2 }} />
            </div>
          ))}
        </Screen>
      </main>
      <Toast show={toast} message="Entry saved" />
      {mode === 'nav' ? (
        <BottomNav />
      ) : (
        <RestTimerPill
          key={restKey}
          workoutId="preview-glass"
          sessionSeed={restKey}
          defaultSeconds={seconds}
          nextUpLabel="Barbell Row · set 2"
          onDismiss={() => setRestKey((key) => key + 1)}
        />
      )}
    </div>
  );
}
