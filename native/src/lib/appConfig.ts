import Constants from 'expo-constants';
import { create } from 'zustand';

import { onAppVisible } from '@/lib/appVisibility';
import { fetchPublicConfig, isOlderThan, type PublicConfig } from '@/lib/appConfig';
import { supabase } from '@/lib/supabase';
import { isPreviewActive } from '~/platform/previewFlag';

/**
 * The server's public switches (src/lib/appConfig), read at launch and on
 * each return to the app, at most every few minutes. Null until a clear
 * answer arrives, and null changes nothing.
 */
export const useAppConfigStore = create<{ config: PublicConfig | null }>(() => ({ config: null }));

const RECHECK_MS = 5 * 60_000;
let lastAsked = 0;
let asking = false;

export async function refreshAppConfig(force = false): Promise<void> {
  if (isPreviewActive() || asking) return;
  if (!force && Date.now() - lastAsked < RECHECK_MS) return;
  asking = true;
  lastAsked = Date.now();
  try {
    const config = await fetchPublicConfig(() => supabase.rpc('app_public_config'));
    // An unclear answer keeps the last clear one.
    if (config) useAppConfigStore.setState({ config });
  } finally {
    asking = false;
  }
}

let following = false;
/** Reads the switches now and again whenever the app comes back. Once per launch. */
export function followAppConfig(): void {
  if (following || isPreviewActive()) return;
  following = true;
  void refreshAppConfig(true);
  onAppVisible(() => void refreshAppConfig());
}

/** This build's version, as people see it ("2.0.4"). */
export function appVersion(): string {
  return Constants.expoConfig?.version ?? '';
}

/** The server allows only newer builds than this one. */
export function useUpdateRequired(): boolean {
  return useAppConfigStore((state) => isOlderThan(appVersion(), state.config?.minAppVersion));
}

/** The owner switched food analysis off for everyone (false only on a clear answer). */
export function useAiPaused(): boolean {
  return useAppConfigStore((state) => state.config?.aiEnabled === false);
}
