import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import { loadNativeModule } from './helpers/loadNativeModule';

// Permission to send food to Google's Gemini: asked once per account on the
// phone, before anything is sent, with the privacy policy one tap away.

type AlertButton = { text: string; onPress?: () => void };
type Consent = {
  askAiConsent: () => Promise<boolean>;
  hasAiConsent: () => boolean;
  setAiConsent: (granted: boolean) => void;
  useAiConsentStore: { getState: () => { granted: boolean } };
};

let alerts: { title: string; message: string; buttons: AlertButton[] }[] = [];
const openPage = vi.fn(async () => {});
const useAuthStore = create<{ user: { id: string } | null }>(() => ({ user: { id: 'anna' } }));
const data = new Map<string, string>();

function load(): Consent {
  return loadNativeModule<Consent>('lib/aiConsent.ts', {
    zustand: { create },
    'react-native': { Alert: { alert: (title: string, message: string, buttons: AlertButton[]) => alerts.push({ title, message, buttons }) } },
    '@/stores/authStore': { useAuthStore },
    '~/lib/haptics': { haptics: { success: () => {} } },
    '~/lib/links': { openPage, PRIVACY_URL: 'https://example.test/privacy/' },
  });
}

const press = (text: string) => alerts.at(-1)!.buttons.find((button) => button.text === text)!.onPress?.();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  alerts = [];
  data.clear();
  useAuthStore.setState({ user: { id: 'anna' } });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('asking before food goes to Gemini', () => {
  it('names Google, what is sent and where to turn it off, and sends nothing on Not now', async () => {
    const consent = load();
    const answer = consent.askAiConsent();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toBe('Send this to Google Gemini?');
    expect(alerts[0].message).toMatch(/Gemini AI/);
    expect(alerts[0].message).toMatch(/age, sex, height, weight and goal/);
    expect(alerts[0].message).toMatch(/You › Food analysis/);
    press('Not now');
    expect(await answer).toBe(false);
    expect(consent.hasAiConsent()).toBe(false);
  });

  it('asks once: an Allow holds for the account on this phone', async () => {
    const consent = load();
    const first = consent.askAiConsent();
    press('Allow');
    expect(await first).toBe(true);
    expect(await consent.askAiConsent()).toBe(true);
    expect(alerts).toHaveLength(1);
    // Kept across a relaunch.
    expect(load().hasAiConsent()).toBe(true);
  });

  it('asks again after the privacy policy is read', async () => {
    const consent = load();
    const answer = consent.askAiConsent();
    press('Privacy policy');
    await flush();
    expect(openPage).toHaveBeenCalledWith('https://example.test/privacy/');
    expect(alerts).toHaveLength(2);
    press('Allow');
    expect(await answer).toBe(true);
  });

  it('never carries one account’s answer to another, and can be withdrawn', async () => {
    const consent = load();
    consent.setAiConsent(true);
    expect(consent.useAiConsentStore.getState().granted).toBe(true);
    useAuthStore.setState({ user: { id: 'ben' } });
    expect(consent.useAiConsentStore.getState().granted).toBe(false);
    expect(consent.hasAiConsent()).toBe(false);
    useAuthStore.setState({ user: { id: 'anna' } });
    expect(consent.hasAiConsent()).toBe(true);
    consent.setAiConsent(false);
    expect(consent.hasAiConsent()).toBe(false);
    const answer = consent.askAiConsent();
    expect(alerts).toHaveLength(1);
    press('Allow');
    expect(await answer).toBe(true);
  });
});
