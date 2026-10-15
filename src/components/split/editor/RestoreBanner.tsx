import { formatDistanceToNowStrict } from 'date-fns';
import { History } from 'lucide-react';
import { Button } from '@/components/shared';
import type { StoredSplitDraft } from '@/lib/splitDraftStorage';

/** Offers back unsaved edits found on this device. */
export function RestoreBanner({
  stored,
  changedSince,
  onRestore,
  onDismiss,
}: {
  stored: StoredSplitDraft;
  /** The saved program changed after these edits began. */
  changedSince: boolean;
  onRestore: () => void;
  onDismiss: () => void;
}) {
  const age = formatDistanceToNowStrict(stored.savedAt, { addSuffix: true });
  return (
    <div className="split-offer space-y-3" role="status">
      <p className="flex items-start gap-2.5 text-[15px] leading-[1.4] text-[var(--metal-ink)]">
        <History className="w-4 h-4 mt-0.5 shrink-0 text-[var(--metal-ink-2)]" strokeWidth={1.5} aria-hidden />
        <span>
          Unsaved edits from {age} are on this device.
          {changedSince && (
            <span className="block metal-row-detail mt-1">
              The program has changed since. Restoring replaces those changes when you save.
            </span>
          )}
        </span>
      </p>
      <div className="flex gap-3">
        <Button size="sm" variant="secondary" className="flex-1" onClick={onDismiss}>
          Discard them
        </Button>
        <Button size="sm" className="flex-1" onClick={onRestore}>
          Restore
        </Button>
      </div>
    </div>
  );
}
