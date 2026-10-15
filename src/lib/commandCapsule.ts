/**
 * The command capsule: one floating primary action per screen, shown by the
 * shell's <CommandCapsule /> with the metal ring on its right.
 *
 * Screens register what their one primary action is through
 * `useCommandCapsule` (src/hooks/useCommandCapsule.ts). The newest mounted
 * registration wins; when it unmounts the previous one shows again, and with
 * none the capsule hides. The store never calls actions itself.
 */

export type CapsuleGlyph = 'arrow' | 'plus' | 'check';

/** A tappable value shown in place of the label (e.g. "80 lb"). */
export interface CapsuleValue {
  id: string;
  value: string;
  unit: string;
  /** Unit before the value ("RPE 7"). */
  unitFirst?: boolean;
  /** Muted: a suggestion the user has not entered yet. */
  suggested?: boolean;
  ariaLabel: string;
  onPress?: () => void;
}

export interface CommandCapsuleSpec {
  /** Identity of the action; a new key cross-fades the label. */
  key: string;
  label: string;
  sublabel?: string;
  /** Sublabel announces a problem (red). */
  alert?: boolean;
  glyph: CapsuleGlyph;
  /** Accessible name of the ring; defaults to the label. */
  ariaLabel?: string;
  onPress: () => void;
  /** 0…1: a thin red progress line under the label. */
  progress?: number | null;
  busy?: boolean;
  disabled?: boolean;
  /**
   * `tabbar` docks above the tab bar (native glass or web); `bottom` docks
   * at the bottom edge for chromeless routes, above the rest bar if shown.
   */
  dock?: 'tabbar' | 'bottom';
  /** Values replace label/sublabel; `caption` names what they belong to. */
  values?: CapsuleValue[];
  caption?: string;
}

interface Entry {
  id: number;
  spec: CommandCapsuleSpec;
}

const entries: Entry[] = [];
const listeners = new Set<() => void>();
let nextId = 1;
let current: CommandCapsuleSpec | null = null;

function emit() {
  const top = entries.at(-1)?.spec ?? null;
  if (top === current) return;
  current = top;
  listeners.forEach((listener) => listener());
}

export function registerCommandCapsule(spec: CommandCapsuleSpec): { id: number; update(next: CommandCapsuleSpec): void; release(): void } {
  const entry: Entry = { id: nextId++, spec };
  entries.push(entry);
  emit();
  return {
    id: entry.id,
    update(next) {
      entry.spec = next;
      emit();
    },
    release() {
      const index = entries.indexOf(entry);
      if (index !== -1) entries.splice(index, 1);
      emit();
    },
  };
}

export function readCommandCapsule(): CommandCapsuleSpec | null {
  return current;
}

export function subscribeCommandCapsule(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Comparable view of a spec without its callbacks. */
export function capsuleSignature(spec: CommandCapsuleSpec | null): string {
  if (!spec) return '';
  return JSON.stringify([
    spec.key, spec.label, spec.sublabel ?? '', spec.alert ?? false, spec.glyph, spec.ariaLabel ?? '',
    spec.progress ?? null, spec.busy ?? false, spec.disabled ?? false, spec.dock ?? 'tabbar', spec.caption ?? '',
    (spec.values ?? []).map((value) => [value.id, value.value, value.unit, value.unitFirst ?? false, value.suggested ?? false, value.ariaLabel, Boolean(value.onPress)]),
  ]);
}

/** Test seam. */
export function resetCommandCapsule() {
  entries.length = 0;
  current = null;
  listeners.clear();
}
