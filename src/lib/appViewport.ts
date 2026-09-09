/** Keep pinch magnification out of layout sizing without freezing keyboard state. */
export function appViewport(layoutHeight: number, viewport?: { height: number; offsetTop: number; scale: number } | null) {
  const scale = viewport?.scale || 1;
  const zoomed = Math.abs(scale - 1) > 0.01;
  const height = Math.min(layoutHeight, viewport ? viewport.height * scale : layoutHeight);
  // A zoom pan is not a keyboard offset. At normal scale follow the full
  // native pan, even when WKWebView has also shrunk window.innerHeight.
  const top = zoomed ? 0 : Math.max(0, viewport?.offsetTop ?? 0);
  const inset = Math.max(0, layoutHeight - height - top);
  return { height, top, inset, keyboardOpen: layoutHeight - height > 100, zoomed };
}

/** Scroll containers within the boundary, never the boundary itself or its ancestors. */
export function revealSheetField(field: HTMLElement, boundary: HTMLElement) {
  for (let parent = field.parentElement; parent && parent !== boundary; parent = parent.parentElement) {
    if (parent.scrollHeight <= parent.clientHeight || !/auto|scroll/.test(getComputedStyle(parent).overflowY)) continue;
    const bounds = parent.getBoundingClientRect();
    const rect = field.getBoundingClientRect();
    const margin = 12;
    if (rect.bottom > bounds.bottom - margin) parent.scrollTop += Math.min(rect.top - bounds.top - margin, rect.bottom - bounds.bottom + margin);
    else if (rect.top < bounds.top + margin) parent.scrollTop += rect.top - bounds.top - margin;
  }
}
