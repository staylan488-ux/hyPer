import { getPhotoWorkerSettings, type PhotoAnalysisProvider, type PhotoWorkerSettings } from '@/lib/photoAnalysis';
import { isAppSandboxActive, isPreviewActive } from '@/preview/flag';
import { createRequestIdempotencyKey } from '@/lib/requestIdempotency';

export interface FoodDescriptionSource {
  title: string;
  url: string;
}

export interface FoodDescriptionResult {
  provider: PhotoAnalysisProvider;
  model: string;
  name: string;
  serving_description: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  confidence: number;
  notes: string;
  sources: FoodDescriptionSource[];
}

const PREVIEW_RESULT: FoodDescriptionResult = {
  provider: 'openai',
  model: 'preview',
  name: 'Chicken burrito bowl, restaurant style',
  serving_description: '1 bowl, approximately 520 g',
  calories: 690,
  protein_g: 46,
  carbs_g: 78,
  fat_g: 22,
  confidence: 0.74,
  notes: 'Estimate assumes chicken, rice, black beans, salsa, cheese, and no guacamole.',
  sources: [{ title: 'USDA FoodData Central', url: 'https://fdc.nal.usda.gov/' }],
};

function normalizeUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}
export function normalizeFoodDescriptionResult(payload: FoodDescriptionResult): FoodDescriptionResult {
  const sources = (Array.isArray(payload.sources) ? payload.sources : [])
    .map((source) => ({ title: String(source?.title || '').trim(), url: normalizeUrl(source?.url) }))
    .filter((source): source is { title: string; url: string } => Boolean(source.title && source.url))
    .slice(0, 3);

  return {
    provider: payload.provider === 'anthropic' ? 'anthropic' : 'openai',
    model: String(payload.model || 'CLI default'),
    name: String(payload.name || '').trim(),
    serving_description: String(payload.serving_description || '1 serving').trim(),
    calories: Math.max(0, Number(payload.calories) || 0),
    protein_g: Math.max(0, Number(payload.protein_g) || 0),
    carbs_g: Math.max(0, Number(payload.carbs_g) || 0),
    fat_g: Math.max(0, Number(payload.fat_g) || 0),
    confidence: Math.max(0, Math.min(1, Number(payload.confidence) || 0)),
    notes: String(payload.notes || '').trim(),
    sources,
  };
}

export async function describeFoodWithAi(input: {
  description: string;
  accessToken: string;
  settings?: PhotoWorkerSettings;
}): Promise<FoodDescriptionResult> {
  const description = input.description.trim();
  if (description.length < 5) throw new Error('Describe the food, amount, and preparation in a little more detail.');
  if (description.length > 1500) throw new Error('Keep the description under 1,500 characters.');

  const settings = input.settings || getPhotoWorkerSettings();
  if (isPreviewActive() && !isAppSandboxActive()) {
    return { ...PREVIEW_RESULT, provider: settings.provider };
  }
  if (!settings.url) throw new Error('Set the food-analysis worker URL in Settings first.');

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 150_000);
  try {
    const requestBody = JSON.stringify({ provider: settings.provider, description });
    const response = await fetch(`${settings.url.replace(/\/+$/, '')}/describe`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': await createRequestIdempotencyKey('describe', requestBody),
      },
      body: requestBody,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as (FoodDescriptionResult & { error?: string }) | null;
    if (!response.ok) throw new Error(payload?.error || `Food worker returned ${response.status}.`);

    const result = normalizeFoodDescriptionResult(payload as FoodDescriptionResult);
    if (!result.name) throw new Error('The model did not return a usable food estimate.');
    return result;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Food research timed out. Confirm the Mac worker is running and try again.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
