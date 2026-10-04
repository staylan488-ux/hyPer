import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class TestElement {
  inert = false;
  children: TestElement[] = [];
  parent: TestElement | null = null;
  constructor(readonly name: string) {}
  append(child: TestElement) { child.parent = this; this.children.push(child); return child; }
  contains(other: TestElement | null): boolean {
    for (let node = other; node; node = node.parent) if (node === this) return true;
    return false;
  }
}

let body: TestElement & { style: { overflow: string } };
let observed: (() => void) | undefined;

/** A sheet layer as Modal portals it: a body child holding the dialog. */
function mountSheet(name: string) {
  const layer = body.append(new TestElement(`${name}-layer`));
  const dialog = layer.append(new TestElement(name));
  observed?.();
  return { layer, dialog: dialog as unknown as HTMLElement };
}

function unmount(layer: TestElement) {
  body.children = body.children.filter((child) => child !== layer);
  observed?.();
}

async function load() {
  vi.resetModules();
  return import('../src/lib/sheetLayers');
}

beforeEach(() => {
  body = Object.assign(new TestElement('body'), { style: { overflow: 'auto' } });
  observed = undefined;
  vi.stubGlobal('HTMLElement', TestElement);
  vi.stubGlobal('document', { body });
  vi.stubGlobal('MutationObserver', class {
    constructor(private readonly callback: () => void) {}
    observe() { observed = this.callback; }
    disconnect() { observed = undefined; }
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('sheet layers', () => {
  it('isolates the open sheet and restores the page when it closes', async () => {
    const { openSheetLayer } = await load();
    const root = body.append(new TestElement('root'));
    const sheet = mountSheet('A');

    const release = openSheetLayer(sheet.dialog);
    expect(root.inert).toBe(true);
    expect(sheet.layer.inert).toBe(false);
    expect(sheet.dialog.inert).toBe(false);
    expect(body.style.overflow).toBe('hidden');

    release();
    expect(root.inert).toBe(false);
    expect(body.style.overflow).toBe('auto');
  });

  it('keeps only the sheet painted on top interactive', async () => {
    const { openSheetLayer, topSheet } = await load();
    const root = body.append(new TestElement('root'));
    const lower = mountSheet('A');
    const releaseLower = openSheetLayer(lower.dialog);
    const upper = mountSheet('B');
    const releaseUpper = openSheetLayer(upper.dialog);

    expect(topSheet()).toBe(upper.dialog);
    expect(lower.layer.inert).toBe(true);
    expect(upper.layer.inert).toBe(false);

    releaseUpper();
    expect(topSheet()).toBe(lower.dialog);
    expect(lower.layer.inert).toBe(false);
    expect(lower.dialog.inert).toBe(false);
    expect(root.inert).toBe(true);

    releaseLower();
    expect(root.inert).toBe(false);
  });

  it('never leaves the visible sheet inert when a lower sheet closes and reopens mid-exit', async () => {
    const { openSheetLayer, topSheet } = await load();
    const root = body.append(new TestElement('root'));
    const a = mountSheet('A');
    const releaseA = openSheetLayer(a.dialog);
    const b = mountSheet('B');
    const releaseB = openSheetLayer(b.dialog);

    // A closes under B, then reopens with the same element before its exit ends.
    releaseA();
    const reopenA = openSheetLayer(a.dialog);

    // B still paints over A, so B must take touches.
    expect(topSheet()).toBe(b.dialog);
    expect(b.dialog.inert).toBe(false);
    expect(b.layer.inert).toBe(false);

    releaseB();
    unmount(b.layer);
    expect(a.dialog.inert).toBe(false);
    expect(a.layer.inert).toBe(false);

    reopenA();
    expect(root.inert).toBe(false);
  });

  it('follows paint order when a nested sheet registers before its parent', async () => {
    const { openSheetLayer, topSheet } = await load();
    body.append(new TestElement('root'));
    // A child effect runs before its parent's, but here the parent's layer
    // mounted last, so the parent is the sheet on screen.
    const nested = mountSheet('C');
    const parent = mountSheet('A');
    openSheetLayer(nested.dialog);
    openSheetLayer(parent.dialog);

    expect(topSheet()).toBe(parent.dialog);
    expect(parent.dialog.inert).toBe(false);
    expect(parent.layer.inert).toBe(false);
    expect(nested.layer.inert).toBe(true);
  });

  it('does not freeze the page behind a sheet that is no longer in the document', async () => {
    const { openSheetLayer } = await load();
    const root = body.append(new TestElement('root'));
    const sheet = mountSheet('A');
    openSheetLayer(sheet.dialog);
    expect(root.inert).toBe(true);

    unmount(sheet.layer);
    expect(root.inert).toBe(false);
  });

  it('isolates layers that mount while a sheet is open, then restores them', async () => {
    const { openSheetLayer } = await load();
    const sheet = mountSheet('A');
    const release = openSheetLayer(sheet.dialog);
    const toast = body.append(new TestElement('toast'));
    observed?.();
    expect(toast.inert).toBe(true);

    release();
    expect(toast.inert).toBe(false);
  });

  it('ignores a second release', async () => {
    const { openSheetLayer } = await load();
    const root = body.append(new TestElement('root'));
    const a = mountSheet('A');
    const releaseA = openSheetLayer(a.dialog);
    releaseA();
    const b = mountSheet('B');
    openSheetLayer(b.dialog);
    releaseA();
    expect(root.inert).toBe(true);
    expect(b.layer.inert).toBe(false);
  });
});
