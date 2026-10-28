import { afterEach, describe, expect, it, vi } from 'vitest';

import { isAppVisible, onAppHidden, onAppVisible } from '@/lib/appVisibility';

// Shared hooks learn that the app came back or went away through this helper;
// on the web it follows the page's visibility and unload.
function fakePage(state: DocumentVisibilityState = 'visible') {
  const doc = Object.assign(new EventTarget(), { visibilityState: state });
  const win = new EventTarget();
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  return {
    show() {
      doc.visibilityState = 'visible';
      doc.dispatchEvent(new Event('visibilitychange'));
    },
    hide() {
      doc.visibilityState = 'hidden';
      doc.dispatchEvent(new Event('visibilitychange'));
    },
    unload() {
      win.dispatchEvent(new Event('pagehide'));
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('app visibility on the web', () => {
  it('counts as visible outside a browser', () => {
    expect(isAppVisible()).toBe(true);
  });

  it('follows the page visibility', () => {
    const page = fakePage('hidden');
    expect(isAppVisible()).toBe(false);
    page.show();
    expect(isAppVisible()).toBe(true);
  });

  it('reports each return to the front until disposed', () => {
    const page = fakePage();
    const listener = vi.fn();
    const stop = onAppVisible(listener);
    page.hide();
    expect(listener).not.toHaveBeenCalled();
    page.show();
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    page.hide();
    page.show();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reports hiding and unloading until disposed', () => {
    const page = fakePage();
    const listener = vi.fn();
    const stop = onAppHidden(listener);
    page.show();
    expect(listener).not.toHaveBeenCalled();
    page.hide();
    page.unload();
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    page.hide();
    page.unload();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
