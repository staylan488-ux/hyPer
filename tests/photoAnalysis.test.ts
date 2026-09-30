import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/preview/flag', () => ({
  isPreviewActive: () => false,
  isAppSandboxActive: () => false,
}));

const supabaseMock = vi.hoisted(() => ({
  auth: { getUser: vi.fn(), updateUser: vi.fn() },
}));

vi.mock('@/lib/supabase', () => ({ supabase: supabaseMock }));

import {
  analyzeFoodPhoto,
  checkPhotoWorker,
  getPhotoWorkerSettings,
  hydratePhotoWorkerSettings,
} from '@/lib/photoAnalysis';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('photo analysis transport', () => {
  it('sends top and side images with their capture roles', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        provider: 'openai',
        hint: '27 cm plate',
        images: [
          { angle: 'top', imageBase64: 'top-data', mimeType: 'image/jpeg' },
          { angle: 'side', imageBase64: 'side-data', mimeType: 'image/jpeg' },
        ],
      });
      return new Response(JSON.stringify({
        provider: 'openai',
        model: 'gpt-5.6-sol',
        summary: 'Two views analyzed.',
        items: [{
          name: 'Rice',
          search_query: 'white rice cooked',
          estimated_grams: 180,
          calories: 234,
          protein_g: 4,
          carbs_g: 51,
          fat_g: 0.5,
          confidence: 0.8,
          notes: '',
        }],
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal('window', globalThis);

    const result = await analyzeFoodPhoto({
      images: [
        { angle: 'top', imageBase64: 'top-data', mimeType: 'image/jpeg' },
        { angle: 'side', imageBase64: 'side-data', mimeType: 'image/jpeg' },
      ],
      hint: '27 cm plate',
      accessToken: 'session-token',
      settings: { url: 'https://worker.example', provider: 'openai' },
    });

    expect(result.items[0]).toMatchObject({ name: 'Rice', estimated_grams: 180 });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('rejects more than two images before calling the worker', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal('window', globalThis);

    await expect(analyzeFoodPhoto({
      images: [
        { angle: 'top', imageBase64: '1', mimeType: 'image/jpeg' },
        { angle: 'side', imageBase64: '2', mimeType: 'image/jpeg' },
        { angle: 'side', imageBase64: '3', mimeType: 'image/jpeg' },
      ],
      accessToken: 'session-token',
      settings: { url: 'https://worker.example', provider: 'openai' },
    })).rejects.toThrow('top photo');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports the configured model and reasoning effort for both providers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      providers: ['openai', 'anthropic'],
      authenticatedProviders: ['openai', 'anthropic'],
      models: { openai: 'gpt-5.6-sol', anthropic: 'claude-opus-4-8' },
      efforts: { openai: 'high', anthropic: 'high' },
    }), { status: 200 })));

    const status = await checkPhotoWorker({ url: 'https://worker.example', provider: 'openai' });

    expect(status.models).toEqual({ openai: 'gpt-5.6-sol', anthropic: 'claude-opus-4-8' });
    expect(status.efforts).toEqual({ openai: 'high', anthropic: 'high' });
  });
});

function stubPreferences(initial: Record<string, string> = {}) {
  const preferences = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => preferences.get(key) ?? null,
    setItem: (key: string, value: string) => preferences.set(key, value),
    removeItem: (key: string) => preferences.delete(key),
  });
  return preferences;
}

function metadataUser(id: string, settings?: { url: string; provider: string }) {
  return { data: { user: { id, user_metadata: settings ? { photo_worker_settings: settings } : {} } }, error: null };
}

describe('photo worker settings hydration', () => {
  it('checks account metadata once per user per run', async () => {
    const preferences = stubPreferences();
    supabaseMock.auth.getUser.mockImplementation(async () => metadataUser('hydrate-a'));

    await Promise.all([hydratePhotoWorkerSettings('hydrate-a'), hydratePhotoWorkerSettings('hydrate-a')]);
    await hydratePhotoWorkerSettings('hydrate-a');
    expect(supabaseMock.auth.getUser).toHaveBeenCalledTimes(1);
    expect(preferences.get('hyper.photo-worker.url')).toBeUndefined();

    supabaseMock.auth.getUser.mockImplementation(async () => metadataUser('hydrate-b', {
      url: 'https://b.example', provider: 'anthropic',
    }));
    await hydratePhotoWorkerSettings('hydrate-b');
    expect(supabaseMock.auth.getUser).toHaveBeenCalledTimes(2);
    expect(getPhotoWorkerSettings()).toEqual({ url: 'https://b.example', provider: 'anthropic' });
  });

  it('retries after an offline lookup, whether it throws or returns an error', async () => {
    stubPreferences();
    supabaseMock.auth.getUser.mockRejectedValueOnce(new TypeError('Load failed'));
    await hydratePhotoWorkerSettings('hydrate-c');
    supabaseMock.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: new Error('offline') });
    await hydratePhotoWorkerSettings('hydrate-c');
    supabaseMock.auth.getUser.mockResolvedValueOnce(metadataUser('hydrate-c', {
      url: 'https://c.example', provider: 'openai',
    }));
    await hydratePhotoWorkerSettings('hydrate-c');
    await hydratePhotoWorkerSettings('hydrate-c');

    expect(supabaseMock.auth.getUser).toHaveBeenCalledTimes(3);
    expect(getPhotoWorkerSettings().url).toBe('https://c.example');
  });

  it('never looks up metadata while local settings exist', async () => {
    stubPreferences({ 'hyper.photo-worker.url': 'https://local.example' });
    await hydratePhotoWorkerSettings('hydrate-d');
    expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
    expect(getPhotoWorkerSettings().url).toBe('https://local.example');
  });
});

describe('device AI settings owner', () => {
  const saved = {
    'hyper.photo-worker.url': 'https://a.example',
    'hyper.photo-worker.provider': 'anthropic',
    'hyper.coach.goals': 'Account A goals',
  };

  it('adopts the signed-in account on existing installs and keeps its settings', async () => {
    const preferences = stubPreferences(saved);
    await hydratePhotoWorkerSettings('owner-a');

    expect(preferences.get('hyper.ai-settings.owner')).toBe('owner-a');
    expect(preferences.get('hyper.coach.goals')).toBe('Account A goals');
    expect(getPhotoWorkerSettings()).toEqual({ url: 'https://a.example', provider: 'anthropic' });
    expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
  });

  it('keeps settings and skips the lookup for the same owner', async () => {
    const preferences = stubPreferences({ ...saved, 'hyper.ai-settings.owner': 'owner-a' });
    await hydratePhotoWorkerSettings('owner-a');

    expect(preferences.get('hyper.coach.goals')).toBe('Account A goals');
    expect(getPhotoWorkerSettings().url).toBe('https://a.example');
    expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
  });

  it('clears the previous account settings and restores the new account metadata', async () => {
    const preferences = stubPreferences({ ...saved, 'hyper.ai-settings.owner': 'owner-a' });
    supabaseMock.auth.getUser.mockResolvedValue(metadataUser('owner-b', {
      url: 'https://b.example', provider: 'openai',
    }));
    const pending = hydratePhotoWorkerSettings('owner-b');
    // cleared synchronously, before the lookup resolves
    expect(preferences.get('hyper.coach.goals')).toBeUndefined();
    await pending;

    expect(preferences.get('hyper.ai-settings.owner')).toBe('owner-b');
    expect(getPhotoWorkerSettings()).toEqual({ url: 'https://b.example', provider: 'openai' });
  });

  it('falls back to the build default when the new account has no saved choice', async () => {
    const preferences = stubPreferences({ ...saved, 'hyper.ai-settings.owner': 'owner-a' });
    supabaseMock.auth.getUser.mockResolvedValue(metadataUser('owner-c'));
    await hydratePhotoWorkerSettings('owner-c');

    expect(preferences.has('hyper.photo-worker.url')).toBe(false);
    expect(preferences.has('hyper.coach.goals')).toBe(false);
    const afterSwitch = getPhotoWorkerSettings();
    stubPreferences();
    expect(afterSwitch).toEqual(getPhotoWorkerSettings());
    expect(afterSwitch.url).not.toBe('https://a.example');
  });

  it('restores the first account after switching back even if a lookup failed in between', async () => {
    const preferences = stubPreferences({ 'hyper.ai-settings.owner': 'owner-d' });
    supabaseMock.auth.getUser.mockResolvedValueOnce(metadataUser('owner-d', {
      url: 'https://d.example', provider: 'openai',
    }));
    await hydratePhotoWorkerSettings('owner-d');
    supabaseMock.auth.getUser.mockRejectedValueOnce(new TypeError('Load failed'));
    await hydratePhotoWorkerSettings('owner-e');
    expect(preferences.has('hyper.photo-worker.url')).toBe(false);

    supabaseMock.auth.getUser.mockResolvedValueOnce(metadataUser('owner-d', {
      url: 'https://d.example', provider: 'openai',
    }));
    await hydratePhotoWorkerSettings('owner-d');
    expect(getPhotoWorkerSettings().url).toBe('https://d.example');
  });

  it('drops a lookup that lands after a different account took over', async () => {
    const preferences = stubPreferences({ 'hyper.ai-settings.owner': 'owner-f' });
    let release!: () => void;
    supabaseMock.auth.getUser.mockImplementationOnce(() => new Promise((done) => {
      release = () => done(metadataUser('owner-f', { url: 'https://f.example', provider: 'anthropic' }));
    }));
    const pending = hydratePhotoWorkerSettings('owner-f');

    supabaseMock.auth.getUser.mockResolvedValueOnce(metadataUser('owner-g'));
    await hydratePhotoWorkerSettings('owner-g');
    release();
    await pending;

    expect(preferences.get('hyper.ai-settings.owner')).toBe('owner-g');
    expect(preferences.has('hyper.photo-worker.url')).toBe(false);
    expect(preferences.has('hyper.photo-worker.provider')).toBe(false);

    // switching back still restores the first account's own choice
    supabaseMock.auth.getUser.mockResolvedValueOnce(metadataUser('owner-f', {
      url: 'https://f.example', provider: 'anthropic',
    }));
    await hydratePhotoWorkerSettings('owner-f');
    expect(getPhotoWorkerSettings()).toEqual({ url: 'https://f.example', provider: 'anthropic' });
  });
});
