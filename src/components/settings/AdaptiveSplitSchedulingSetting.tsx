import { useState } from 'react';
import { useAdaptiveSplitScheduling } from '@/hooks/useAdaptiveSplitScheduling';
import { saveAdaptiveSplitScheduling } from '@/lib/adaptiveSplitScheduling';
import { useAuthStore } from '@/stores/authStore';

export function AdaptiveSplitSchedulingSetting() {
  const enabled = useAdaptiveSplitScheduling();
  const userId = useAuthStore((state) => state.user?.id);
  const [feedback, setFeedback] = useState<{ userId: string | undefined; saving: boolean; error: boolean } | null>(null);
  const saving = feedback?.userId === userId && feedback?.saving;
  const error = feedback?.userId === userId && feedback?.error;

  const toggle = async () => {
    if (saving) return;
    setFeedback({ userId, saving: true, error: false });
    try {
      await saveAdaptiveSplitScheduling(!enabled);
      setFeedback({ userId, saving: false, error: false });
    } catch {
      setFeedback({ userId, saving: false, error: true });
    }
  };

  return (
    <section>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-labelledby="adaptive-split-label"
        aria-describedby="adaptive-split-description"
        disabled={saving || !userId}
        onClick={() => void toggle()}
        className="you-row disabled:opacity-60"
      >
        <span id="adaptive-split-label" className="you-row-title flex-1 min-w-0">Adaptive split scheduling</span>
        <span aria-hidden="true" className="t-label-sm shrink-0">{enabled ? 'On' : 'Off'}</span>
        <span aria-hidden="true" className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${enabled ? 'bg-[var(--color-text)]' : 'bg-[var(--color-border-strong)]'}`}>
          <span className={`absolute top-1 h-4 w-4 rounded-full bg-[var(--color-base)] ${enabled ? 'right-1' : 'left-1'}`} />
        </span>
      </button>
      <p id="adaptive-split-description" className="t-body mt-4">
        Adjust upcoming workouts and rest days based on the split day you complete.
        When off, keep your saved schedule.
      </p>
      {saving && <p role="status" className="t-caption mt-3">Saving…</p>}
      {error && <p role="alert" className="t-body mt-3">Couldn’t save this setting. Your previous choice is still active. Try the switch again.</p>}
    </section>
  );
}
