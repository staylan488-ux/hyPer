/**
 * A wheel has two sources of movement. A tap chooses its value immediately;
 * scroll events from centering that tap must not choose intermediate values.
 * A new user gesture explicitly gives selection back to scrolling.
 */
export function createWheelSelection(initialIndex: number, onSelect: (index: number) => void) {
  let selected = initialIndex;
  let userScrolling = false;
  const commit = (index: number) => {
    if (index === selected) return;
    selected = index;
    onSelect(index);
  };
  return {
    beginGesture() { userScrolling = true; },
    choose(index: number) {
      userScrolling = false;
      commit(index);
    },
    scroll(index: number) {
      if (userScrolling) commit(index);
    },
  };
}
