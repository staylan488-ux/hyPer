import type { MacroTargetSource } from '@/types';

export interface SettingsDirtyState {
  name: boolean;
  targets: boolean;
  worker: boolean;
  meal: boolean;
  coach: boolean;
  weight: boolean;
}
/** Child setup/help flows retain drafts; abandoning their task asks first. */
export function shouldBlockSettingsExit(
  current: string,
  next: string,
  dirty: SettingsDirtyState,
): boolean {
  if (current === next) return false;
  if (!next.startsWith('/settings')) return Object.values(dirty).some(Boolean);
  if (dirty.name && current === '/settings/account' && next !== current) return true;
  if (dirty.meal && current === '/settings/meals' && next !== current) return true;
  if (dirty.worker && current === '/settings/analysis/worker' && next !== current) return true;
  const targetTask = (path: string) =>
    path.startsWith('/settings/targets') || path === '/settings/analysis/worker';
  if ((dirty.targets || dirty.coach) && targetTask(current) && !targetTask(next)) return true;
  if (dirty.weight) return true;
  return false;
}

export function targetModeLabel(
  source: MacroTargetSource | undefined,
  enabled: boolean | undefined,
): string {
  if (!source) return 'Not set';
  if (source === 'manual') return 'Manual';
  if (!enabled) return 'Calculated · automatic updates off';
  return source === 'adaptive' ? 'Adaptive' : 'Calculated · can adapt';
}
