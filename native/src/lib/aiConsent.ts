import { Alert } from 'react-native';
import { create } from 'zustand';

import { useAuthStore } from '@/stores/authStore';
import { haptics } from '~/lib/haptics';
import { openPage, PRIVACY_URL } from '~/lib/links';

/**
 * Permission to send food to Google's Gemini (Apple's rule 5.1.2(i): say who
 * gets personal data, AI included, and ask first). Asked once per account on
 * this phone, before the first request that would leave it: Analyze meal,
 * Describe amount when it needs the AI, and Suggest targets. Withdrawn in
 * You › Food analysis, after which the next request asks again.
 *
 * Bump CONSENT_VERSION when what is sent changes, so everyone is asked again.
 */
const CONSENT_KEY = 'hyper.ai-consent';
const CONSENT_VERSION = 1;

function accountKey(): string {
  const id = useAuthStore.getState().user?.id;
  return `${id ?? 'signed-out'}:${CONSENT_VERSION}`;
}

function readGranted(): string[] {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(CONSENT_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function writeGranted(entries: string[]) {
  try {
    globalThis.localStorage?.setItem(CONSENT_KEY, JSON.stringify(entries));
  } catch {
    // storage unavailable: the answer holds until the app closes
  }
}

/** Whether the signed-in account allowed it on this phone; follows account changes. */
export const useAiConsentStore = create<{ key: string; granted: boolean }>(() => ({ key: accountKey(), granted: readGranted().includes(accountKey()) }));

function sync() {
  const key = accountKey();
  if (useAiConsentStore.getState().key !== key) useAiConsentStore.setState({ key, granted: readGranted().includes(key) });
}
useAuthStore.subscribe(sync);

export function hasAiConsent(): boolean {
  sync();
  return useAiConsentStore.getState().granted;
}

export function setAiConsent(granted: boolean): void {
  const key = accountKey();
  const others = readGranted().filter((entry) => entry !== key);
  writeGranted(granted ? [...others, key] : others);
  useAiConsentStore.setState({ key, granted });
}

export const AI_CONSENT_TITLE = 'Send this to Google Gemini?';
export const AI_CONSENT_MESSAGE =
  'To estimate food, hyPer sends your meal photos and what you type to Google’s Gemini AI, ' +
  'which may look products up on the web through Tavily. Suggest targets also sends your age, sex, height, weight and goal. ' +
  'Nothing is sent until you allow it. You can turn this off in You › Food analysis.';

/**
 * True when the request may go: allowed before, or allowed now. Otherwise
 * asks in an alert, with the privacy policy one tap away (the alert comes back
 * after it). Not now sends nothing.
 */
export function askAiConsent(): Promise<boolean> {
  if (hasAiConsent()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const ask = () =>
      Alert.alert(
        AI_CONSENT_TITLE,
        AI_CONSENT_MESSAGE,
        [
          {
            text: 'Allow',
            onPress: () => {
              haptics.success();
              setAiConsent(true);
              resolve(true);
            },
          },
          {
            text: 'Privacy policy',
            onPress: () => {
              void openPage(PRIVACY_URL).then(ask);
            },
          },
          { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        ],
        { cancelable: false },
      );
    ask();
  });
}
