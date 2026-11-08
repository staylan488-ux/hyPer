// @vitest-environment happy-dom
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import { parseNativeOAuthCallback } from '@/lib/nativeOAuthCallback';
import * as authLink from '../native/src/lib/authLink';
import * as launchLink from '../native/src/lib/launchLink';
import { loadNativeModule } from './helpers/loadNativeModule';

// A tap on a widget, the workout card or the run card can launch the app
// from cold. The saved session is still being read then, so the router can
// only show the way in (index); the link waits there until the app opens.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Screen = 'boot' | 'offline' | 'sign-in' | 'new-password' | 'app';

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
  const getSession = vi.fn();
  let redirectSystemPath: (input: { path: string; initial: boolean }) => string;

  beforeEach(() => {
    launchLink.dropLaunchLink();
    authLink.useAuthLinkError.getState().clear();
    exchangeCodeForSession.mockReset().mockResolvedValue({ data: {}, error: null });
    getSession.mockReset().mockResolvedValue({ data: { session: null }, error: null });
    ({ redirectSystemPath } = loadNativeModule<{ redirectSystemPath: typeof redirectSystemPath }>('app/+native-intent.tsx', {
      '@/lib/nativeBridge': { NATIVE_AUTH_REDIRECT_URL: 'app.hyper.mobile://auth/callback' },
      '@/lib/nativeOAuthCallback': { parseNativeOAuthCallback },
      '@/lib/supabase': { supabase: { auth: { exchangeCodeForSession, getSession } } },
      '~/lib/authLink': authLink,
      '~/lib/launchLink': launchLink,
    }));
  });

  it('exchanges a password reset link like a confirmation, and the session says which', async () => {
    expect(redirectSystemPath({ path: 'app.hyper.mobile://auth/callback?code=reset-code', initial: true })).toBe('/');
    expect(exchangeCodeForSession).toHaveBeenCalledWith('reset-code');
    await vi.waitFor(() => expect(exchangeCodeForSession).toHaveReturned());
    expect(authLink.useAuthLinkError.getState().message).toBeNull();
  });

  it('says on sign-in when a link has expired or was used', async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: { message: 'invalid flow state, no valid flow state found' } });
    redirectSystemPath({ path: 'app.hyper.mobile://auth/callback?code=old-code', initial: false });
    await vi.waitFor(() => expect(authLink.useAuthLinkError.getState().message).toBe(authLink.AUTH_LINK_FAILED));
  });

  it('says so too when the link came back with an error instead of a code', async () => {
    const path = 'app.hyper.mobile://auth/callback?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
    expect(redirectSystemPath({ path, initial: true })).toBe('/');
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(authLink.useAuthLinkError.getState().message).toBe(authLink.AUTH_LINK_FAILED));
  });

  it('stays quiet about a failed link while someone is signed in', async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: { message: 'invalid flow state' } });
    getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null });
    redirectSystemPath({ path: 'app.hyper.mobile://auth/callback?code=old-code', initial: false });
    await vi.waitFor(() => expect(getSession).toHaveBeenCalled());
    await Promise.resolve();
    expect(authLink.useAuthLinkError.getState().message).toBeNull();
  });

  it('remembers the widget link that launched the app and routes it as before', () => {
    expect(redirectSystemPath({ path: 'app.hyper.mobile://fuel', initial: true })).toBe('app.hyper.mobile://fuel');
    expect(launchLink.pendingLaunchLink()).toBe('/fuel');
  });

  it('leaves a link to the running app to the router', () => {
    expect(redirectSystemPath({ path: 'app.hyper.mobile://train', initial: false })).toBe('app.hyper.mobile://train');
    expect(launchLink.pendingLaunchLink()).toBeNull();
  });

  it('keeps widget and card taps from closing an open run or a sheet above it', () => {
    const release = launchLink.holdRunLinks();
    try {
      for (const path of ['/train', '/fuel', '/you/targets', '/run']) {
        expect(redirectSystemPath({ path: `app.hyper.mobile://${path.slice(1)}`, initial: false })).toBe('');
      }
      expect(launchLink.pendingLaunchLink()).toBeNull();
      expect(redirectSystemPath({ path: '/fuel', initial: true })).toBe('/fuel');
      expect(redirectSystemPath({ path: 'app.hyper.mobile://auth/callback?code=pkce-code', initial: false })).toBe('/');
      expect(exchangeCodeForSession).toHaveBeenCalledOnce();
    } finally {
      release();
    }
    expect(redirectSystemPath({ path: '/fuel', initial: false })).toBe('/fuel');
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

  it('shows the new password screen first after a reset link', async () => {
    await mount();
    await show('new-password');
    expect(redirects.at(-1)).toBe('/new-password');
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
