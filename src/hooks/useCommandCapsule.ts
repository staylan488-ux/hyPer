import { useEffect, useLayoutEffect, useRef } from 'react';
import { capsuleSignature, registerCommandCapsule, type CommandCapsuleSpec } from '@/lib/commandCapsule';

/**
 * Register this screen's one primary action on the floating command capsule
 * while the component is mounted. Pass `null` to hide the capsule (loading,
 * nothing to do). Callbacks may change every render; the latest is called.
 *
 *   useCommandCapsule({ key: 'start', label: 'Start Upper A',
 *     sublabel: '17 sets · Bench Press first', glyph: 'arrow', onPress: start });
 */
export function useCommandCapsule(spec: CommandCapsuleSpec | null) {
  const latest = useRef(spec);
  const registration = useRef<ReturnType<typeof registerCommandCapsule> | null>(null);
  const signature = capsuleSignature(spec);
  const active = spec !== null;

  useLayoutEffect(() => {
    latest.current = spec;
  });

  useEffect(() => {
    const live = latest.current;
    if (!live) return;
    // Callbacks route through `latest`, so a re-render never re-registers.
    const routed = withLatestCallbacks(live, latest);
    const handle = registerCommandCapsule(routed);
    registration.current = handle;
    return () => {
      handle.release();
      registration.current = null;
    };
  }, [active]);

  useEffect(() => {
    const live = latest.current;
    if (!live || !registration.current) return;
    registration.current.update(withLatestCallbacks(live, latest));
  }, [signature]);
}

function withLatestCallbacks(spec: CommandCapsuleSpec, latest: { current: CommandCapsuleSpec | null }): CommandCapsuleSpec {
  return {
    ...spec,
    onPress: () => latest.current?.onPress(),
    values: spec.values?.map((value, index) => ({
      ...value,
      onPress: value.onPress ? () => latest.current?.values?.[index]?.onPress?.() : undefined,
    })),
  };
}
