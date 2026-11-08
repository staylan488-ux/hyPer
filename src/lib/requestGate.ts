// Latest-request-wins guard for async UI work. begin() hands back an isCurrent
// check that turns false as soon as a newer request begins or the gate is
// invalidated (the user left the view, or the component unmounted), so a late
// response can be dropped instead of overwriting newer state.
export function createRequestGate() {
  let latest = 0;
  return {
    begin(): () => boolean {
      const id = ++latest;
      return () => id === latest;
    },
    invalidate() {
      latest += 1;
    },
  };
}

export type RequestGate = ReturnType<typeof createRequestGate>;

// Reads of a value the app also saves. A read begun before a save landed may
// hold what that save replaced, so it must not be shown: begin() at a read's
// start hands back its isCurrent check, which turns false once saved() is
// called as a save lands. Reads never cancel each other.
export function createSaveGate() {
  let saves = 0;
  return {
    begin(): () => boolean {
      const at = saves;
      return () => saves === at;
    },
    saved() {
      saves += 1;
    },
  };
}
