import { useEffect, useSyncExternalStore } from 'react';
import { Button } from './Button';
import { Modal } from './Modal';
import { confirmSnapshot, registerConfirmHost, settleConfirm, subscribeConfirm } from '@/lib/confirmDialog';

/** Shows questions from `requestConfirm` as a sheet over whatever is open. */
export function ConfirmDialogHost() {
  // The last question stays rendered while the sheet animates out.
  const { request: content, open } = useSyncExternalStore(subscribeConfirm, confirmSnapshot, confirmSnapshot);

  useEffect(() => registerConfirmHost(), []);

  return (
    <Modal isOpen={open} onClose={() => settleConfirm(false)} title={content?.title}>
      <div className="space-y-4 pt-1">
        {content?.message && <p className="t-body text-[var(--color-text)]">{content.message}</p>}
        <div className="flex gap-3 pt-1">
          <Button variant="secondary" className="flex-1" onClick={() => settleConfirm(false)}>
            {content?.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            variant={content?.destructive ? 'danger' : 'primary'}
            className="flex-1"
            onClick={() => settleConfirm(true)}
          >
            {content?.confirmLabel ?? 'Confirm'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
