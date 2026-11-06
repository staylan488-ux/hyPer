import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { fieldLabel, speak, spokenClock, spokenLabel, spokenUnit } from '../native/src/lib/spoken';
import { FIGURE_MAX_SCALE, RAMP_POINTS, ROLE_RAMPS, SIZE_SCALES, rampScale, roleScale, sizeIndex } from '../native/src/theme/textSize';

const SOURCE = path.resolve(__dirname, '../native/src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.tsx') || entry.name.endsWith('.ts') ? [full] : [];
  });
}

const files = sourceFiles(SOURCE).map((file) => ({
  name: path.relative(SOURCE, file).split(path.sep).join('/'),
  text: readFileSync(file, 'utf8'),
}));

/** A JSX element's opening tag, from `<Name` to its closing `>` (props may hold braces and arrows). */
function openingTag(text: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote && text[index - 1] !== '\\') quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    else if (char === '>' && depth === 0) return text.slice(start, index + 1);
  }
  return text.slice(start);
}

/** Every opening tag of a component in the app, with where it is. */
function elements(name: string) {
  return files.flatMap(({ name: file, text }) =>
    [...text.matchAll(new RegExp(`<${name}[\\s>]`, 'g'))].map((match) => ({
      where: `${file}:${text.slice(0, match.index).split('\n').length}`,
      tag: openingTag(text, match.index ?? 0),
    })),
  );
}

const hasProp = (tag: string, prop: string) => new RegExp(`\\s${prop}[=\\s/>]`).test(tag);

describe('VoiceOver words for Blanc shorthand', () => {
  it('reads middle dots as pauses, ranges as "to" and units as words', () => {
    expect(speak('Set 2 of 3 · 8–10 reps')).toBe('Set 2 of 3, 8 to 10 reps');
    expect(speak('Now · 3 × 8–12 · last 135 × 8')).toBe('Now, 3 × 8 to 12, last 135 × 8');
    expect(speak('135 lb × 8')).toBe('135 pounds × 8');
    expect(speak('1 lb')).toBe('1 pound');
    expect(speak('Eaten 1,200 / 2,800 kcal')).toBe('Eaten 1,200 of 2,800 calories');
    expect(speak('Protein 30 g · 12.5 g fat')).toBe('Protein 30 grams, 12.5 grams fat');
    expect(speak('In progress · 12 min')).toBe('In progress, 12 minutes');
    expect(speak('↑ Beat last time · +5 lb')).toBe('Beat last time, +5 pounds');
    expect(speak('1,858 kcal left')).toBe('1,858 calories left');
    expect(speak('kcal over')).toBe('calories over');
    expect(speak('October, avg\u00a0172.4\u00a0lb')).toBe('October, average 172.4 pounds');
    expect(speak('+4.1 lb since Aug 7\u00a0· +0.43 lb/wk')).toBe('+4.1 pounds since Aug 7, +0.43 pounds a week');
    // As the app writes durations and run distances: "1h 20m", "400 m", "+30 s".
    expect(speak('1h 20m')).toBe('1 hour 20 minutes');
    expect(speak('2 h · 45m')).toBe('2 hours, 45 minutes');
    expect(speak('400 m · 3.1 mi · 5 km')).toBe('400 meters, 3.1 miles, 5 kilometers');
    expect(speak('+30 s')).toBe('+30 seconds');
    expect(speak('Peak 4.2 m/s')).toBe('Peak 4.2 meters per second');
    expect(speak('3 sets · 12 min')).toBe('3 sets, 12 minutes');
    expect(speak('+0.42 lb/wk')).toBe('+0.42 pounds a week');
    expect(speak('7:59 /mi')).toBe('7:59 per mile');
    expect(speak('2,400 kcal/day')).toBe('2,400 calories a day');
    expect(speak('under · add ~2 sets this week')).toBe('under, add about 2 sets this week');
    expect(speak('180 cm · 5 ft · 34 yrs')).toBe('180 centimeters, 5 feet, 34 years');
    // "in" is never a unit: "10 in range" stays as it is.
    expect(speak('8 of 10 in range')).toBe('8 of 10 in range');
  });

  it('leaves words, dates and plain numbers alone', () => {
    for (const text of ['Bench press', 'Nov 4', '11/4', 'Log set', 'RPE 8', 'go 5 golf', 'Day 1', '2 sets', 'Push day']) {
      expect(speak(text)).toBe(text);
      expect(spokenLabel(text)).toBeUndefined();
    }
    expect(spokenLabel('8–10 reps')).toBe('8 to 10 reps');
  });

  it('names units and fields as VoiceOver should say them', () => {
    expect(spokenUnit('kcal')).toBe('calories');
    expect(spokenUnit('g')).toBe('grams');
    expect(spokenUnit('%')).toBe('percent');
    expect(spokenUnit('reps')).toBe('reps');
    expect(fieldLabel('Protein', 'g')).toBe('Protein, grams');
    expect(fieldLabel('Calories', 'kcal')).toBe('Calories');
    expect(fieldLabel('Name')).toBe('Name');
    expect(fieldLabel('Plate diameter', 'cm')).toBe('Plate diameter, centimeters');
    expect(fieldLabel('Age', 'yrs')).toBe('Age, years');
  });

  it('says clock readings in words', () => {
    expect(spokenClock(65)).toBe('1 minute 5 seconds');
    expect(spokenClock(60)).toBe('1 minute');
    expect(spokenClock(5)).toBe('5 seconds');
    expect(spokenClock(0)).toBe('0 seconds');
    expect(spokenClock(3725)).toBe('1 hour 2 minutes 5 seconds');
  });
});

describe('Dynamic Type', () => {
  it('changes nothing at the standard text size', () => {
    for (const role of Object.keys(ROLE_RAMPS) as (keyof typeof ROLE_RAMPS)[]) {
      expect(roleScale(role, 1)).toBe(1);
    }
  });

  it('follows iOS text styles: small text grows more than big text', () => {
    const ax5 = SIZE_SCALES[SIZE_SCALES.length - 1];
    expect(rampScale('footnote', ax5)).toBeGreaterThan(rampScale('body', ax5));
    expect(rampScale('body', ax5)).toBeGreaterThan(rampScale('title3', ax5));
    expect(rampScale('title3', ax5)).toBeGreaterThan(rampScale('largeTitle', ax5));
    expect(roleScale('body', ax5)).toBeCloseTo(53 / 17, 5);
    expect(roleScale('secondary', SIZE_SCALES[4])).toBeCloseTo(17 / 15, 5);
  });

  it('grows every style a little at each larger size', () => {
    for (const points of Object.values(RAMP_POINTS)) {
      expect(points).toHaveLength(SIZE_SCALES.length);
      points.slice(1).forEach((size, index) => expect(size).toBeGreaterThanOrEqual(points[index]));
    }
  });

  it('caps big figures and gives every type role a ramp or a cap', () => {
    expect(roleScale('figure', SIZE_SCALES[4])).toBeCloseTo(SIZE_SCALES[4], 5);
    expect(roleScale('figure', SIZE_SCALES[SIZE_SCALES.length - 1])).toBe(FIGURE_MAX_SCALE);
    // The theme imports React Native, so its roles are read as text.
    const theme = readFileSync(path.join(SOURCE, 'theme/blanc.ts'), 'utf8');
    const roles = [...(theme.match(/export const type = \{([\s\S]*?)\} satisfies/)?.[1] ?? '').matchAll(/^ {2}(\w+): \{/gm)].map((match) => match[1]);
    expect(roles.length).toBeGreaterThan(8);
    expect(roles.sort()).toEqual(Object.keys(ROLE_RAMPS).sort());
  });

  it('reads React Native multipliers as the nearest text size', () => {
    SIZE_SCALES.forEach((scale, index) => expect(sizeIndex(scale)).toBe(index));
    expect(sizeIndex(1.0001)).toBe(3);
  });
});

/** WCAG contrast between two #RRGGBB colours, or an rgba() over a solid one. */
function contrast(foreground: string, background: string): number {
  const rgb = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = ([r, g, b]: number[]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  const [high, low] = [luminance(rgb(foreground)), luminance(rgb(background))].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

/** A palette's solid colours, read from the theme's text. */
function palette(name: string): Record<string, string> {
  const theme = readFileSync(path.join(SOURCE, 'theme/blanc.ts'), 'utf8');
  const body = theme.match(new RegExp(`\\n {2}${name}: \\{([\\s\\S]*?)\\n {2}\\}`))?.[1] ?? '';
  return Object.fromEntries([...body.matchAll(/(\w+): '(#[0-9A-F]{6})'/g)].map((match) => [match[1], match[2]]));
}

describe('contrast', () => {
  const surfaces = ['ground', 'label', 'fill', 'pressed'];

  it('keeps ink and graphite at 4.5:1 or more on every surface', () => {
    for (const name of ['light', 'dark', 'lightContrast', 'darkContrast']) {
      const colours = palette(name);
      expect(Object.keys(colours).length).toBeGreaterThan(8);
      for (const tone of ['ink', 'graphite']) {
        for (const surface of surfaces) {
          expect(contrast(colours[tone], colours[surface]), `${name} ${tone} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('lifts every text tone to 4.5:1 or more, and graphite to 6:1, with Increase Contrast', () => {
    for (const name of ['lightContrast', 'darkContrast']) {
      const colours = palette(name);
      for (const tone of ['ink', 'graphite', 'upcoming', 'live']) {
        for (const surface of ['ground', 'label']) {
          expect(contrast(colours[tone], colours[surface]), `${name} ${tone} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      for (const surface of surfaces) {
        expect(contrast(colours.graphite, colours[surface]), `${name} graphite on ${surface}`).toBeGreaterThanOrEqual(6);
        expect(contrast(colours.upcoming, colours[surface]), `${name} upcoming on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps the chalk, the labels and the P as they are with Increase Contrast', () => {
    expect(palette('lightContrast').ground).toBe(palette('light').ground);
    expect(palette('lightContrast').label).toBe(palette('light').label);
    expect(palette('lightContrast').brand).toBe(palette('light').brand);
    expect(palette('darkContrast').ground).toBe(palette('dark').ground);
    expect(palette('darkContrast').brand).toBe(palette('dark').brand);
  });

  it('draws white swipe labels on a red that reads with Increase Contrast, in both appearances', () => {
    // SwipeRow uses the light contrast red as its fill whenever Increase Contrast is on.
    expect(contrast('#FFFFFF', palette('lightContrast').live)).toBeGreaterThanOrEqual(4.5);
    expect(readFileSync(path.join(SOURCE, 'components/SwipeRow.tsx'), 'utf8')).toMatch(/useIncreaseContrast\(\) \? palettes\.lightContrast\.live : c\.live/);
  });
});

describe('native accessibility', () => {
  it('announces status lines through useAnnounce: accessibilityLiveRegion is Android only', () => {
    const wrong = files.filter(({ text }) => /accessibilityLiveRegion/.test(text)).map(({ name }) => name);
    expect(wrong).toEqual([]);
  });

  it('names every text field for VoiceOver', () => {
    const fields = elements('TextInput');
    expect(fields.length).toBeGreaterThan(15);
    // A field that spreads its props (FigureInput, sign-in's Field) takes its caller's label.
    const wrong = fields.filter(({ tag }) => !hasProp(tag, 'accessibilityLabel') && !tag.includes('{...')).map(({ where }) => where);
    expect(wrong).toEqual([]);
  });

  it('gives every pressable a role, or leaves it to a control inside', () => {
    const pressables = elements('Pressable').concat(elements('AnimatedPressable'));
    expect(pressables.length).toBeGreaterThan(40);
    const wrong = pressables
      .filter(({ tag }) => !hasProp(tag, 'accessibilityRole') && !/\saccessible=\{false\}/.test(tag) && !tag.includes('{...'))
      .map(({ where }) => where);
    expect(wrong).toEqual([]);
  });

  it('names every icon-only button', () => {
    // A pressable with a symbol and no words of its own needs a label.
    const wrong = files.flatMap(({ name, text }) =>
      [...text.matchAll(/<Pressable[\s>]/g)].flatMap((match) => {
        const start = match.index ?? 0;
        const end = text.indexOf('</Pressable>', start);
        const body = end > 0 ? text.slice(start, end) : '';
        const tag = openingTag(text, start);
        const iconOnly = body.includes('<SymbolView') && !/<BlancText|<RollingText|<Text[\s>]/.test(body);
        // accessible={false}: a wrapper whose control inside (a field) carries the name.
        const named = hasProp(tag, 'accessibilityLabel') || /\saccessible=\{false\}/.test(tag);
        return iconOnly && !named ? [`${name}:${text.slice(0, start).split('\n').length}`] : [];
      }),
    );
    expect(wrong).toEqual([]);
  });

  it('plays one haptic per tap: no extra tap or select on controls that play their own', () => {
    // Row, Capsule, GlassButton and Chip (unless haptic={false}) play a haptic themselves.
    const own = ['Row', 'Capsule', 'GlassButton', 'Chip'].flatMap((name) => elements(name));
    expect(own.length).toBeGreaterThan(40);
    const wrong = own
      .filter(({ tag }) => !/\shaptic=\{false\}/.test(tag))
      .filter(({ tag }) => /onPress=\{[^]*?haptics\.(tap|select)\(/.test(tag))
      .map(({ where }) => where);
    expect(wrong).toEqual([]);
  });

  it('names or hides every image', () => {
    const images = elements('Image');
    // A SwiftUI Image (Expo UI) takes these as modifiers instead of props.
    const swiftNamedOrHidden = (tag: string) => /accessibilityHidden\(true\)|accessibilityLabel\(/.test(tag);
    const wrong = images
      .filter(({ tag }) => !hasProp(tag, 'accessibilityLabel') && !hasProp(tag, 'accessible') && !hasProp(tag, 'accessibilityElementsHidden') && !swiftNamedOrHidden(tag))
      .map(({ where }) => where);
    expect(wrong).toEqual([]);
  });
});
