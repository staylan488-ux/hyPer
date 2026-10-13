/**
 * In-app confirmation, in place of window.confirm. A caller awaits
 * `requestConfirm`; the mounted <ConfirmDialogHost> shows the question as a
 * sheet and settles it. Without a host the answer is "no", so nothing
 * destructive happens unseen.
 */
export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm action as destructive. */
  destructive?: boolean;
}

export interface ConfirmRequest extends ConfirmOptions {
  id: number;
}

let current: (ConfirmRequest & { resolve: (confirmed: boolean) => void }) | null = null;
// What a host renders: the open question, or the last one while its sheet closes.
let snapshot: { request: ConfirmRequest | null; open: boolean } = { request: null, open: false };
let nextId = 1;
let hosts = 0;
const listeners = new Set<() => void>();

function emit() {
  snapshot = current
    ? { request: current, open: true }
    : { request: snapshot.request, open: false };
  for (const listener of listeners) listener();
}

export function requestConfirm(options: ConfirmOptions): Promise<boolean> {
  if (hosts === 0) return Promise.resolve(false);
  // A newer question replaces one still open; the older one counts as declined.
  current?.resolve(false);
  return new Promise<boolean>((resolve) => {
    current = { ...options, id: nextId++, resolve };
    emit();
  });
}

export function settleConfirm(confirmed: boolean): void {
  const request = current;
  if (!request) return;
  current = null;
  request.resolve(confirmed);
  emit();
}

export function currentConfirm(): ConfirmRequest | null {
  return current;
}

export function confirmSnapshot(): { request: ConfirmRequest | null; open: boolean } {
  return snapshot;
}

export function subscribeConfirm(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Registers a mounted host; returns its release. */
export function registerConfirmHost(): () => void {
  hosts += 1;
  return () => {
    hosts -= 1;
    if (hosts === 0) settleConfirm(false);
  };
}
