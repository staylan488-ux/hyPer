/**
 * Hairline rules under the scroll-edge band. Text dissolves through the band's
 * ramp, but a 1px rule there turns into a smeared ghost line under the compact
 * title that reads as a navigation-bar hairline. So rules leave earlier than
 * text: a rule fades out over `RULE_FADE` px as it rises to `RULE_CLEAR` px
 * below the ramp's foot, and stays out above that, wherever the page rests.
 *
 * Rules are found by what draws them: a top or bottom border, a 1–2px filled
 * box, or a thin `::before` / `::after` (`.platter-row` dividers). Borders are
 * faded inline from their own colour; pseudo-elements through `--rule-veil`
 * (`[data-rule-veil]` in liquid.css). Form fields and sticky headers
 * (`[data-rest-band]`) keep their own edges.
 */
export const RULE_CLEAR = 8;
export const RULE_FADE = 12;

type Kind = 'top' | 'bottom' | 'before' | 'after' | 'self';
export interface RuleCarrier { element: HTMLElement; kind: Kind; offset: number; color?: string }
type Carrier = RuleCarrier;

const alphaOf = (color: string) => {
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (!match) return 0;
  const alpha = match[1].split(/[\s,/]+/).filter(Boolean)[3];
  return alpha === undefined ? 1 : parseFloat(alpha);
};
const withAlpha = (color: string, factor: number) => {
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (!match) return color;
  const [r, g, b, a] = match[1].split(/[\s,/]+/).filter(Boolean);
  const alpha = (a === undefined ? 1 : parseFloat(a)) * factor;
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
};

/** Visibility a rule keeps at `y` under a band whose ramp ends at `foot` (both from the viewport's top). */
export function ruleVisibility(y: number, foot: number): number {
  const t = (y - (foot + RULE_CLEAR)) / RULE_FADE;
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** Every hairline rule under `root`, at its offset in the scroll column
 *  (`columnTop`: the column's top from the window's). */
export function findRuleCarriers(root: HTMLElement, columnTop: number): RuleCarrier[] {
  const carriers: RuleCarrier[] = [];
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    if (element.closest('svg, [data-rest-band], [data-rest-ignore]') || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)) continue;
    const style = getComputedStyle(element);
    if (style.display === 'none') continue;
    const rect = element.getBoundingClientRect();
    if (rect.width < 20) continue;
    const top = rect.top - columnTop;
    if (parseFloat(style.borderTopWidth) >= 0.5 && style.borderTopStyle !== 'none' && alphaOf(style.borderTopColor) > 0) {
      carriers.push({ element, kind: 'top', offset: top, color: style.borderTopColor });
    }
    if (parseFloat(style.borderBottomWidth) >= 0.5 && style.borderBottomStyle !== 'none' && alphaOf(style.borderBottomColor) > 0) {
      carriers.push({ element, kind: 'bottom', offset: rect.bottom - columnTop - 1, color: style.borderBottomColor });
    }
    if (rect.height <= 2 && alphaOf(style.backgroundColor) > 0) carriers.push({ element, kind: 'self', offset: top });
    for (const kind of ['before', 'after'] as const) {
      const pseudo = getComputedStyle(element, `::${kind}`);
      if (pseudo.content === 'none' || pseudo.display === 'none') continue;
      const height = parseFloat(pseudo.height);
      if (!(height <= 2) || alphaOf(pseudo.backgroundColor) <= 0) continue;
      const offset = pseudo.top.endsWith('px') ? top + parseFloat(pseudo.top)
        : pseudo.bottom.endsWith('px') ? rect.bottom - columnTop - parseFloat(pseudo.bottom) - height : null;
      if (offset !== null) carriers.push({ element, kind, offset });
    }
  }
  return carriers;
}

export function createRuleVeil(root: HTMLElement, viewport: HTMLElement) {
  let carriers: Carrier[] = [];
  const applied = new Map<Carrier, number>();

  const clear = (carrier: Carrier) => {
    const { element, kind } = carrier;
    if (kind === 'top') element.style.removeProperty('border-top-color');
    else if (kind === 'bottom') element.style.removeProperty('border-bottom-color');
    else if (kind === 'self') element.style.removeProperty('opacity');
    else {
      element.style.removeProperty('--rule-veil');
      element.removeAttribute('data-rule-veil');
    }
    applied.delete(carrier);
  };

  const collect = () => {
    for (const carrier of applied.keys()) clear(carrier);
    carriers = findRuleCarriers(root, viewport.getBoundingClientRect().top - viewport.scrollTop);
  };

  /** Fades the rules for a band whose ramp ends at `foot` (from the viewport's top); null: no band. */
  const update = (foot: number | null) => {
    const scrolled = viewport.scrollTop;
    for (const carrier of carriers) {
      const factor = foot === null ? 1 : ruleVisibility(carrier.offset - scrolled, foot);
      const previous = applied.get(carrier);
      if (factor >= 0.999) {
        if (previous !== undefined) clear(carrier);
        continue;
      }
      if (previous !== undefined && Math.abs(previous - factor) < 0.01) continue;
      const { element, kind, color } = carrier;
      if (kind === 'top') element.style.setProperty('border-top-color', withAlpha(color!, factor));
      else if (kind === 'bottom') element.style.setProperty('border-bottom-color', withAlpha(color!, factor));
      else if (kind === 'self') element.style.setProperty('opacity', factor.toFixed(3));
      else {
        element.setAttribute('data-rule-veil', kind);
        element.style.setProperty('--rule-veil', factor.toFixed(3));
      }
      applied.set(carrier, factor);
    }
  };

  const dispose = () => {
    for (const carrier of Array.from(applied.keys())) clear(carrier);
    carriers = [];
  };

  return { collect, update, dispose };
}
