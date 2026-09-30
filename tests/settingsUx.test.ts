import { describe, expect, it } from 'vitest';
import {
  shouldBlockSettingsExit,
  targetModeLabel,
  targetSummaryLabel,
  type SettingsDirtyState,
} from '@/lib/settingsUx';

const clean: SettingsDirtyState = { name: false, targets: false, worker: false, meal: false, coach: false, weight: false };
const dirtyWith = (...keys: (keyof SettingsDirtyState)[]): SettingsDirtyState => ({
  ...clean,
  ...Object.fromEntries(keys.map((key) => [key, true])),
});

describe('settings navigation draft protection', () => {
  it.each([
    ['/settings', '/settings/targets'],
    ['/settings/targets/edit', '/settings/targets'],
    ['/settings/analysis/worker', '/settings/analysis'],
    ['/settings/account', '/train'],
  ])('allows clean navigation from %s to %s', (from, to) => {
    expect(shouldBlockSettingsExit(from, to, clean)).toBe(false);
  });

  it.each(['name', 'targets', 'worker', 'meal', 'coach', 'weight'] as const)(
    'protects an unsaved %s draft when leaving You for another tab', (key) => {
      expect(shouldBlockSettingsExit('/settings', '/nutrition', dirtyWith(key))).toBe(true);
    },
  );

  it('does not block a navigation that stays on the same path', () => {
    expect(shouldBlockSettingsExit('/settings/targets/edit', '/settings/targets/edit', dirtyWith('targets', 'weight'))).toBe(false);
  });

  it.each([
    ['/settings/account', '/settings', 'name'],
    ['/settings/meals', '/settings/targets', 'meal'],
    ['/settings/analysis/worker', '/settings/targets/coach', 'worker'],
    ['/settings/weight', '/settings', 'weight'],
  ] as const)('protects the %s editor when leaving for %s', (from, to, key) => {
    expect(shouldBlockSettingsExit(from, to, dirtyWith(key))).toBe(true);
  });

  it.each(['targets', 'coach'] as const)('retains the %s draft through related tasks', (key) => {
    const taskPaths = [
      '/settings/targets', '/settings/targets/edit', '/settings/targets/calculate',
      '/settings/targets/coach', '/settings/targets/adaptation', '/settings/analysis/worker',
    ];
    for (const from of taskPaths) {
      for (const to of taskPaths) {
        expect(shouldBlockSettingsExit(from, to, dirtyWith(key)), `${from} → ${to}`).toBe(false);
      }
    }
  });

  it.each(['targets', 'coach'] as const)('guards leaving the %s task, including its worker setup', (key) => {
    for (const from of ['/settings/targets/edit', '/settings/targets/coach', '/settings/analysis/worker']) {
      for (const to of ['/settings', '/settings/appearance', '/settings/analysis']) {
        expect(shouldBlockSettingsExit(from, to, dirtyWith(key)), `${from} → ${to}`).toBe(true);
      }
    }
  });

  it('requires resolving worker changes before returning to a retained coach or target draft', () => {
    expect(shouldBlockSettingsExit('/settings/analysis/worker', '/settings/targets/coach', dirtyWith('targets', 'coach', 'worker'))).toBe(true);
    expect(shouldBlockSettingsExit('/settings/analysis/worker', '/settings/targets/coach', dirtyWith('targets', 'coach'))).toBe(false);
  });

  it('protects an open weight entry even when navigating between related target screens', () => {
    expect(shouldBlockSettingsExit('/settings/targets', '/settings/targets/edit', dirtyWith('targets', 'weight'))).toBe(true);
  });
});

describe('truthful nutrition target mode labels', () => {
  it.each([true, false, undefined])('does not present missing targets as saved (adaptive=%s)', (enabled) => {
    expect(targetModeLabel(undefined, enabled)).toBe('Not set');
  });

  it.each([true, false, undefined])('manual targets stay manual regardless of profile adaptive setting (%s)', (enabled) => {
    expect(targetModeLabel('manual', enabled)).toBe('Manual');
  });

  it('distinguishes a calculation eligible to adapt from an existing adaptive target', () => {
    expect(targetModeLabel('calculated', true)).toBe('Calculated · can adapt');
    expect(targetModeLabel('adaptive', true)).toBe('Adaptive');
  });

  it.each(['calculated', 'adaptive'] as const)('does not promise automatic updates for %s without an enabled profile', (source) => {
    expect(targetModeLabel(source, false)).toBe('Calculated · automatic updates off');
    expect(targetModeLabel(source, undefined)).toBe('Calculated · automatic updates off');
  });
});

describe('nutrition target summary while targets refresh', () => {
  it('shows cached targets instead of a loading flash', () => {
    expect(targetSummaryLabel('loading', 2400, 'Manual')).toBe(`${(2400).toLocaleString()} kcal · Manual`);
  });

  it('keeps the loading text when nothing is cached, since null may mean not loaded yet', () => {
    expect(targetSummaryLabel('loading', null, 'Not set')).toBe('Loading targets…');
  });

  it('reports a failed load even when cached targets exist', () => {
    expect(targetSummaryLabel('error', 2400, 'Manual')).toBe('Could not load targets');
  });

  it('distinguishes loaded targets from unsaved defaults', () => {
    expect(targetSummaryLabel('ready', 2100, 'Adaptive')).toBe(`${(2100).toLocaleString()} kcal · Adaptive`);
    expect(targetSummaryLabel('ready', null, 'Not set')).toBe('Starting defaults · not saved');
  });
});
