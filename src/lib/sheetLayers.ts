/**
 * Modal sheets portal straight into <body> and make every other layer inert,
 * so only the sheet the user can see takes touches. Each change recomputes the
 * whole picture from the set of open sheets instead of toggling flags as
 * sheets come and go: a sheet that closes underneath another, reopens during
 * its exit animation, or mounts in the same commit as a nested sheet can
 * otherwise be left inert while it is on screen, with the rest of the app
 * inert behind it, and nothing on screen responds until a reload.
 */

const openSheets: HTMLElement[] = [];
const backgroundInert = new Map<HTMLElement, boolean>();
let previousBodyOverflow = '';
let backgroundObserver: MutationObserver | undefined;

function bodyLayers(): HTMLElement[] {
  return Array.from(document.body.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
}

/**
 * The open sheet that paints on top. Every sheet layer is a body child at the
 * same z-index, so the one latest in the document is the one on screen, even
 * when sheets opened in a different order from their layers' mounting.
 */
export function topSheet(): HTMLElement | undefined {
  const layers = bodyLayers();
  let top: HTMLElement | undefined;
  let topIndex = -1;
  for (const sheet of openSheets) {
    const index = layers.findIndex((layer) => layer.contains(sheet));
    if (index !== -1 && index >= topIndex) {
      top = sheet;
      topIndex = index;
    }
  }
  return top;
}

function isolateSheets() {
  const top = topSheet();
  for (const sheet of openSheets) sheet.inert = sheet !== top;
  for (const layer of bodyLayers()) {
    if (!backgroundInert.has(layer)) backgroundInert.set(layer, layer.inert);
    // With no open sheet on screen there is nothing to protect: never leave
    // the whole page inert behind a sheet that is not there.
    layer.inert = !top || layer.contains(top) ? backgroundInert.get(layer) ?? false : true;
  }
}

/** Register an open sheet; the returned release runs when it closes. */
export function openSheetLayer(dialog: HTMLElement): () => void {
  if (openSheets.length === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  if (!openSheets.includes(dialog)) openSheets.push(dialog);
  isolateSheets();
  if (!backgroundObserver) {
    backgroundObserver = new MutationObserver(isolateSheets);
    backgroundObserver.observe(document.body, { childList: true });
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const index = openSheets.indexOf(dialog);
    if (index !== -1) openSheets.splice(index, 1);
    // A closing sheet's element can be reused if it reopens mid-exit.
    dialog.inert = false;
    if (openSheets.length) {
      isolateSheets();
      return;
    }
    document.body.style.overflow = previousBodyOverflow;
    backgroundObserver?.disconnect();
    backgroundObserver = undefined;
    for (const [layer, inert] of backgroundInert) layer.inert = inert;
    backgroundInert.clear();
  };
}
