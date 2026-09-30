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
