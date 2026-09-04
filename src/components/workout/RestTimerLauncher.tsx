import { createPortal } from 'react-dom';
import { Timer } from 'lucide-react';
import { tapHaptic } from '@/lib/haptics';

export function RestTimerLauncher({ onStart }: { onStart: () => void }) {
  return createPortal(<section className="studio-workout-dock studio-workout-idle" aria-label="Workout controls">
    <p className="t-caption mb-4">Select a saved set to edit, add a set, or finish your workout.</p>
    <button type="button" className="studio-save-set" onClick={() => { tapHaptic(); onStart(); }}>
      Start rest timer <Timer size={16} />
    </button>
  </section>, document.body);
}
