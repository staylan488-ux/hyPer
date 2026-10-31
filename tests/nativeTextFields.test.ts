import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = path.resolve(__dirname, '../native/src');

// A big figure's only placeholder is "–", a single glyph, and its digits need
// their own line height to sit right.
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

describe('native one-line text fields', () => {
  it('finds the app’s text fields', () => {
    expect(textInputs().length).toBeGreaterThan(10);
  });

  // iOS drew a one-line field's placeholder with its letters squeezed
  // together (nearly overlapping) when the field's style had a line height.
  it('keeps line heights off every one-line field and gives it tail truncation', () => {
    // The JSX prop only: FieldRow turns multiline on for its wrapping rows alone.
    const multiline = /\smultiline(?=[\s=/>])/;
    const tail = /lineBreakModeIOS=("tail"|\{[^}]*'tail'[^}]*\})/;
    const wrong = textInputs()
      .filter(({ file, element }) => !ALLOWED.has(file) && !multiline.test(element))
      .filter(({ element }) =>
        !tail.test(element) ||
        element.includes('lineHeight') ||
        (/typeScale\.(?!field\b)\w+/.test(element) && !element.includes('typeScale.field')),
      )
      .map(({ file, line }) => `${file}:${line}`);
    expect(wrong).toEqual([]);
  });

  it('gives the field type the body size and no line height', () => {
    // The theme imports React Native, so it is read as text here.
    const theme = readFileSync(path.join(SOURCE, 'theme/blanc.ts'), 'utf8');
    const body = theme.match(/^ {2}body: (\{.*\}),$/m)?.[1];
    const field = theme.match(/^ {2}field: (\{.*\}),$/m)?.[1];
    expect(body).toMatch(/fontSize: 17\b/);
    expect(field).toBe('{ fontSize: 17 }');
  });
});
