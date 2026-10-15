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
        className="metal-row you-row disabled:opacity-60"
      >
        <span id="adaptive-split-label" className="metal-row-title flex-1 min-w-0">Adaptive split scheduling</span>
        <span aria-hidden="true" className="metal-row-value">{enabled ? 'On' : 'Off'}</span>
        <span aria-hidden="true" className={`you-switch${enabled ? ' is-on' : ''}`}>
          <span />
        </span>
      </button>
      <p id="adaptive-split-description" className="you-copy">
        Adjust upcoming workouts and rest days based on the split day you complete.
        When off, keep your saved schedule.
      </p>
      {saving && <p role="status" className="you-status">Saving…</p>}
      {error && <p role="alert" className="you-status is-error">Couldn’t save this setting. Your previous choice is still active. Try the switch again.</p>}
    </section>
  );
}
