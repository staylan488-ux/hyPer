import { isPreviewActive } from '@/preview/flag';

export type PhotoAnalysisProvider = 'openai' | 'anthropic';

export interface PhotoAnalysisItem {
  name: string;
  search_query: string;
  estimated_grams: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  confidence: number;
  notes: string;
}

export interface PhotoAnalysisResult {
  provider: PhotoAnalysisProvider;
  items: PhotoAnalysisItem[];
  summary: string;
}

export interface PhotoWorkerSettings {
  url: string;
  provider: PhotoAnalysisProvider;
}

const URL_KEY = 'hyper.photo-worker.url';
const PROVIDER_KEY = 'hyper.photo-worker.provider';
const DEFAULT_URL = 'http://127.0.0.1:8788';

export function getPhotoWorkerSettings(): PhotoWorkerSettings {
  const storage = globalThis.localStorage;
  const storedProvider = storage?.getItem(PROVIDER_KEY);
  return {
    url: storage?.getItem(URL_KEY)?.trim() || DEFAULT_URL,
    provider: storedProvider === 'anthropic' ? 'anthropic' : 'openai',
  };
}

export function savePhotoWorkerSettings(settings: PhotoWorkerSettings): void {
  const normalizedUrl = settings.url.trim().replace(/\/+$/, '');
  globalThis.localStorage?.setItem(URL_KEY, normalizedUrl);
  globalThis.localStorage?.setItem(PROVIDER_KEY, settings.provider);
}

function normalizeItem(item: PhotoAnalysisItem): PhotoAnalysisItem {
  return {
    name: String(item.name || '').trim(),
    search_query: String(item.search_query || item.name || '').trim(),
    estimated_grams: Math.max(1, Number(item.estimated_grams) || 100),
    calories: Math.max(0, Number(item.calories) || 0),
    protein_g: Math.max(0, Number(item.protein_g) || 0),
    carbs_g: Math.max(0, Number(item.carbs_g) || 0),
    fat_g: Math.max(0, Number(item.fat_g) || 0),
    confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)),
    notes: String(item.notes || '').trim(),
  };
}

const PREVIEW_RESULT: PhotoAnalysisResult = {
  provider: 'openai',
  summary: 'Three visible components. Oil is included as a separate low-confidence estimate.',
  items: [
    { name: 'Chicken breast, grilled', search_query: 'chicken breast grilled', estimated_grams: 155, calories: 256, protein_g: 48, carbs_g: 0, fat_g: 5.5, confidence: 0.91, notes: 'Skinless sliced chicken breast.' },
    { name: 'White rice, cooked', search_query: 'white rice cooked', estimated_grams: 190, calories: 247, protein_g: 5.1, carbs_g: 53.6, fat_g: 0.6, confidence: 0.86, notes: 'Approximately one heaped cup.' },
    { name: 'Olive oil', search_query: 'olive oil', estimated_grams: 8, calories: 71, protein_g: 0, carbs_g: 0, fat_g: 8, confidence: 0.48, notes: 'Visible sheen suggests added cooking oil; confirm or remove.' },
  ],
};

export async function analyzeFoodPhoto(input: {
  imageBase64: string;
  mimeType: string;
  hint?: string;
  accessToken: string;
  settings?: PhotoWorkerSettings;
}): Promise<PhotoAnalysisResult> {
  const settings = input.settings || getPhotoWorkerSettings();
  if (isPreviewActive()) return { ...PREVIEW_RESULT, provider: settings.provider };
  if (!settings.url) throw new Error('Set the photo worker URL in Settings before analyzing a photo.');

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 150_000);
  try {
    const response = await fetch(`${settings.url.replace(/\/+$/, '')}/analyze`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: settings.provider,
        imageBase64: input.imageBase64,
        mimeType: input.mimeType,
        hint: input.hint?.trim() || null,
      }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null) as (PhotoAnalysisResult & { error?: string }) | null;
    if (!response.ok) throw new Error(payload?.error || `Photo worker returned ${response.status}.`);
    const items = (payload?.items || []).map(normalizeItem).filter((item) => item.name);
    if (items.length === 0) throw new Error('The model did not identify any foods. Add a hint or retake the photo.');
    return {
      provider: payload?.provider === 'anthropic' ? 'anthropic' : 'openai',
      summary: String(payload?.summary || ''),
      items,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Photo analysis timed out. Confirm the Mac worker is running and try again.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function checkPhotoWorker(settings = getPhotoWorkerSettings()): Promise<{ ok: boolean; providers: string[]; authenticatedProviders: string[]; error?: string }> {
  try {
    const response = await fetch(`${settings.url.replace(/\/+$/, '')}/health`, { signal: AbortSignal.timeout(5_000) });
    const payload = await response.json() as { providers?: string[]; authenticatedProviders?: string[]; error?: string };
    return {
      ok: response.ok,
      providers: payload.providers || [],
      authenticatedProviders: payload.authenticatedProviders || [],
      error: payload.error,
    };
  } catch (error) {
    return { ok: false, providers: [], authenticatedProviders: [], error: error instanceof Error ? error.message : 'Worker unavailable' };
  }
}
