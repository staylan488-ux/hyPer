import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/preview/flag', () => ({
  isPreviewActive: () => false,
  isAppSandboxActive: () => false,
}));

import { analyzeFoodPhoto, checkPhotoWorker } from '@/lib/photoAnalysis';

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
