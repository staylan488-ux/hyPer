// "A workout action was pressed here": Capsule tells whoever listens (the
// glass field behind the app sends its warm wave up from that point) when an
// effort capsule (Log set, Resume, Start, Finish workout) is pressed.
//
// The point is in window points, from the top-left of the screen: where the
// finger went down on the capsule. The press is reported when it lands (the
// action runs), never for a touch that turned into a scroll.

export type GlassPress = {
  /** Window x of the fingertip, in points. */
  x: number;
  /** Window y of the fingertip, in points. */
  y: number;
  /** What kind of action: only workout actions are reported today. */
  tone: 'effort';
  /** Date.now() when the press landed. */
  at: number;
};

type Listener = (press: GlassPress) => void;

const listeners = new Set<Listener>();

/** Listens for effort presses; returns the function that stops listening. */
export function onGlassPress(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reports an effort press to every listener. A listener that throws never stops the others or the tap. */
export function emitGlassPress(press: Omit<GlassPress, 'at'> & { at?: number }) {
  const event: GlassPress = { ...press, at: press.at ?? Date.now() };
  listeners.forEach((listener) => {
    try {
      listener(event);
    } catch {
      // The button's own action matters more than the wave behind it.
    }
  });
}
