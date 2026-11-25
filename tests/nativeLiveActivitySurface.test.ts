import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const WIDGETS = path.resolve(__dirname, '../native/targets/widgets');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('Lock Screen Live Activity platter', () => {
  const activityFiles = readdirSync(WIDGETS)
    .filter((file) => file.endsWith('LiveActivity.swift'))
    .sort();

  it('covers both the workout and run Live Activities', () => {
    expect(activityFiles).toEqual(['RunLiveActivity.swift', 'WorkoutLiveActivity.swift']);
  });

  // Leaving the platter on iOS's default material avoids ActivityKit's light/dark
  // background tint desync (FB15148099) and prevents warm chalk (#F2F1ED) from
  // tinting Liquid Glass into muddy gold behind dark-mode ink.
  it.each(activityFiles)('%s leaves the lock-screen platter on iOS default material', (file) => {
    const code = stripComments(readFileSync(path.join(WIDGETS, file), 'utf8'));
    expect(code).not.toContain('.activityBackgroundTint(');
    expect(code).not.toContain('.activitySystemActionForegroundColor(');
  });
});
