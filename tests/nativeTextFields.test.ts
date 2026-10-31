import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = path.resolve(__dirname, '../native/src');

// The big figure input sets its own tight letter spacing and line height on
// purpose; its only placeholder is "–".
const ALLOWED = new Set(['components/FigureInput.tsx']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.tsx') ? [full] : [];
  });
}

/** Every <TextInput … /> element in the app, with the file it is in. */
function textInputs() {
  return sourceFiles(SOURCE).flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    const name = path.relative(SOURCE, file).split(path.sep).join('/');
    const found: { file: string; line: number; element: string }[] = [];
    for (const match of text.matchAll(/<TextInput\s/g)) {
      const start = match.index;
      const end = text.indexOf('/>', start);
      found.push({ file: name, line: text.slice(0, start).split('\n').length, element: text.slice(start, end + 2) });
    }
    return found;
  });
}

// The JSX prop only: FieldRow turns multiline on for its wrapping rows alone.
const multiline = /\smultiline(?=[\s=/>])/;
const tail = /lineBreakModeIOS=("tail"|\{[^}]*'tail'[^}]*\})/;
const where = ({ file, line }: { file: string; line: number }) => `${file}:${line}`;

describe('native text fields', () => {
  const fields = textInputs().filter(({ file }) => !ALLOWED.has(file));

  it('finds the app’s text fields', () => {
    expect(fields.length).toBeGreaterThan(15);
  });

  // React Native reuses a field's native view, and iOS drew the new
  // placeholder with the old one's letter spacing (a big figure's, squeezing
  // the letters together) unless the field's text style names its own.
  it('gives every field a field text style and no spacing or line height of its own', () => {
    const wrong = fields
      .filter(({ element }) => !/typeScale\.field(Lines)?\b/.test(element) || /lineHeight|letterSpacing/.test(element))
      .map(where);
    expect(wrong).toEqual([]);
  });

  it('keeps line heights off one-line fields and gives them tail truncation', () => {
    const wrong = fields
      .filter(({ element }) => !multiline.test(element))
      .filter(({ element }) => !/typeScale\.field\b/.test(element) || !tail.test(element))
      .map(where);
    expect(wrong).toEqual([]);
  });

  it('gives fields that wrap the line height of body text', () => {
    const wrong = fields
      .filter(({ element }) => multiline.test(element) && !element.includes('typeScale.fieldLines'))
      .map(where);
    expect(wrong).toEqual([]);
  });

  it('defines the field types with their own non-zero letter spacing', () => {
    // The theme imports React Native, so it is read as text here.
    const theme = readFileSync(path.join(SOURCE, 'theme/blanc.ts'), 'utf8');
    const spacing = Number(theme.match(/^const FIELD_SPACING = ([\d.]+);$/m)?.[1]);
    expect(spacing).toBeGreaterThan(0);
    expect(spacing).toBeLessThan(0.05);
    expect(theme).toMatch(/^ {2}body: \{ fontSize: 17, lineHeight: 22 \},$/m);
    expect(theme).toMatch(/^ {2}field: \{ fontSize: 17, letterSpacing: FIELD_SPACING \},$/m);
    expect(theme).toMatch(/^ {2}fieldLines: \{ fontSize: 17, lineHeight: 22, letterSpacing: FIELD_SPACING \},$/m);
  });
});
