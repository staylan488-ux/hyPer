// @vitest-environment happy-dom
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import * as launchLink from '../native/src/lib/launchLink';
import { loadNativeModule } from './helpers/loadNativeModule';

// A tap on a widget, the workout card or the run card can launch the app
// from cold. The saved session is still being read then, so the router can
// only show the way in (index); the link waits there until the app opens.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Screen = 'boot' | 'offline' | 'sign-in' | 'app';

describe('launch link store', () => {
  beforeEach(() => launchLink.dropLaunchLink());

  it('reads the widget and card links in either app scheme', () => {
    expect(launchLink.launchPath('app.hyper.mobile://fuel')).toBe('/fuel');
    expect(launchLink.launchPath('hyper-native://train')).toBe('/train');
    expect(launchLink.launchPath('app.hyper.mobile://you/targets')).toBe('/you/targets');
    expect(launchLink.launchPath('app.hyper.mobile://run')).toBe('/run');
    expect(launchLink.launchPath('app.hyper.mobile:///fuel/')).toBe('/fuel');
    expect(launchLink.launchPath('/train')).toBe('/train');
  });

  it('keeps nothing for any other link', () => {
    for (const link of [
      'app.hyper.mobile://',
      'app.hyper.mobile:///',
      'app.hyper.mobile://auth/callback?code=abc',
      'app.hyper.mobile://settings',
      'app.hyper.mobile://fuel/../you/account',
      'app.hyper.mobile://you',
      'https://example.com/fuel',
      'exp+hyper-native://expo-development-client/?url=http%3A%2F%2F10.0.0.2%3A8081',
    ]) {
      launchLink.rememberLaunchLink(link);
      expect(launchLink.pendingLaunchLink(), link).toBeNull();
    }
  });

  it('knows every link the widgets and cards open, and each is an app screen', () => {
    const native = resolve(dirname(fileURLToPath(import.meta.url)), '../native');
    const widgets = join(native, 'targets/widgets');
    const links = readdirSync(widgets)
      .filter((file) => file.endsWith('.swift'))
      .flatMap((file) => readFileSync(join(widgets, file), 'utf8').split('\n'))
      .filter((line) => line.includes('.widgetURL(appURL('))
      .flatMap((line) => [...line.matchAll(/"([^"]+)"/g)].map((match) => match[1]));
    expect(new Set(links)).toEqual(new Set(['fuel', 'you/targets', 'train', 'run']));
    for (const link of links) {
      const path = launchLink.launchPath(`app.hyper.mobile://${link}`);
      expect(path, link).toBe(`/${link}`);
      const files = [`${link}.tsx`, `${link}/index.tsx`, `(tabs)/${link}.tsx`, `(tabs)/${link}/index.tsx`];
      expect(files.some((file) => existsSync(join(native, 'src/app', file))), link).toBe(true);
    }
  });

  it('keeps a widget link until it is dropped', () => {
    launchLink.rememberLaunchLink('app.hyper.mobile://fuel?from=widget');
    expect(launchLink.pendingLaunchLink()).toBe('/fuel');
    expect(launchLink.pendingLaunchLink()).toBe('/fuel');
    launchLink.dropLaunchLink();
    expect(launchLink.pendingLaunchLink()).toBeNull();
  });
});

describe('links that launch the app', () => {
  const exchangeCodeForSession = vi.fn();
  let redirectSystemPath: (input: { path: string; initial: boolean }) => string;

  beforeEach(() => {
    launchLink.dropLaunchLink();
    exchangeCodeForSession.mockReset().mockResolvedValue({ data: {}, error: null });
    ({ redirectSystemPath } = loadNativeModule<{ redirectSystemPath: typeof redirectSystemPath }>('app/+native-intent.tsx', {
      '@/lib/nativeBridge': { NATIVE_AUTH_REDIRECT_URL: 'app.hyper.mobile://auth/callback' },
      '@/lib/nativeOAuthCallback': { parseNativeOAuthCallback: () => ({ code: 'pkce-code' }) },
      '@/lib/supabase': { supabase: { auth: { exchangeCodeForSession } } },
      '~/lib/launchLink': launchLink,
    }));
  });

  it('remembers the widget link that launched the app and routes it as before', () => {
    expect(redirectSystemPath({ path: 'app.hyper.mobile://fuel', initial: true })).toBe('app.hyper.mobile://fuel');
    expect(launchLink.pendingLaunchLink()).toBe('/fuel');
  });

  it('leaves a link to the running app to the router', () => {
    expect(redirectSystemPath({ path: 'app.hyper.mobile://train', initial: false })).toBe('app.hyper.mobile://train');
    expect(launchLink.pendingLaunchLink()).toBeNull();
  });

  it('still exchanges the email confirmation and keeps no launch link for it', () => {
    expect(redirectSystemPath({ path: 'app.hyper.mobile://auth/callback?code=pkce-code', initial: true })).toBe('/');
    expect(exchangeCodeForSession).toHaveBeenCalledWith('pkce-code');
    expect(launchLink.pendingLaunchLink()).toBeNull();
  });
});

describe('the way in after a launch link', () => {
  const useScreen = create<{ screen: Screen }>(() => ({ screen: 'boot' }));
  const replace = vi.fn();
  const push = vi.fn();
  let redirects: string[];
  let root: Root;
  let host: HTMLDivElement;
  let Index: () => unknown;

  function Redirect({ href }: { href: string }) {
    redirects.push(href);
    return null;
  }

  async function mount() {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(Index as () => null)));
  }

  async function show(screen: Screen) {
    await act(async () => useScreen.setState({ screen }));
  }

  async function unmount() {
    await act(async () => root.unmount());
    host.remove();
  }

  beforeEach(() => {
    launchLink.dropLaunchLink();
    useScreen.setState({ screen: 'boot' });
    redirects = [];
    replace.mockReset();
    push.mockReset();
    ({ default: Index } = loadNativeModule<{ default: typeof Index }>('app/index.tsx', {
      'expo-router': { Redirect, router: { replace, push } },
      '~/lib/auth': { useAuthScreen: () => useScreen((state) => state.screen) },
      '~/lib/launchLink': launchLink,
    }));
  });

  afterEach(async () => {
    if (root) await unmount();
  });

  it('opens the linked screen once the saved session is read, and only once', async () => {
    launchLink.rememberLaunchLink('app.hyper.mobile://fuel');
    await mount();
    expect(redirects).toEqual([]);
    await show('app');
    expect(redirects.at(-1)).toBe('/fuel');
    expect(launchLink.pendingLaunchLink()).toBeNull();

    await unmount();
    redirects = [];
    await mount();
    expect(redirects.at(-1)).toBe('/today');
  });

  it('opens Today when nothing was linked', async () => {
    await mount();
    await show('app');
    expect(redirects.at(-1)).toBe('/today');
  });

  it('drops the link when sign-in comes first', async () => {
    launchLink.rememberLaunchLink('app.hyper.mobile://train');
    await mount();
    await show('sign-in');
    expect(redirects.at(-1)).toBe('/sign-in');
    expect(launchLink.pendingLaunchLink()).toBeNull();

    await unmount();
    redirects = [];
    await mount();
    await show('app');
    expect(redirects.at(-1)).toBe('/today');
  });

  it('keeps the link through the offline wait', async () => {
    launchLink.rememberLaunchLink('app.hyper.mobile://you/targets');
    await mount();
    await show('offline');
    expect(redirects.at(-1)).toBe('/offline');

    await unmount();
    redirects = [];
    await mount();
    await show('app');
    expect(redirects.at(-1)).toBe('/you/targets');
  });

  it('opens the run over Today, so closing it lands there', async () => {
    launchLink.rememberLaunchLink('app.hyper.mobile://run');
    await mount();
    await show('app');
    expect(redirects).toEqual([]);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/today');
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/run');
    expect(replace.mock.invocationCallOrder[0]).toBeLessThan(push.mock.invocationCallOrder[0]);
  });
});
