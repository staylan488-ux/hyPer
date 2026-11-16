import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// The old weekly grade claimed more than anyone knows; its words are gone
// from the app (owner decision, 2026-11-12). Weekly sets are measured against
// the program, in three plain bands, with no upper limit.

const root = path.join(__dirname, '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : files(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const code = [...files(path.join(root, 'src')), ...files(path.join(root, 'native/src'))]
  // The imported research notes keep their own wording.
  .filter((file) => !file.endsWith(path.join('evidence', 'snapshot.ts')));

describe('the retired weekly grade', () => {
  it('leaves none of its words in the app', () => {
    const found: string[] = [];
    for (const file of code) {
      const text = readFileSync(file, 'utf8');
      for (const word of [/under-stimulated/i, /adaptive zone/i, /growth is compounding/i, /\blandmarks?\b/i, /'Effective'/, /muscles? in range/i]) {
        if (word.test(text)) found.push(`${path.relative(root, file)}: ${word}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('gives training volume no ceiling', () => {
    const volumeFiles = code.filter((file) => /muscle|volume|progress|week|maquette|program/i.test(path.basename(file)));
    expect(volumeFiles.length).toBeGreaterThan(5);
    for (const file of volumeFiles) expect(readFileSync(file, 'utf8'), path.relative(root, file)).not.toMatch(/ceiling/i);
  });
});
