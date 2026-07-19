import { describe, expect, it } from 'vitest';
import { normalizeFoodDescriptionResult } from '@/lib/foodDescription';

describe('food description result normalization', () => {
  it('clamps numeric fields and keeps only safe web citations', () => {
    const result = normalizeFoodDescriptionResult({
      provider: 'anthropic',
      model: 'test',
      name: '  Burrito bowl  ',
      serving_description: ' one bowl ',
      calories: 650,
      protein_g: 42,
      carbs_g: 80,
      fat_g: -2,
      confidence: 1.4,
      notes: ' estimate ',
      sources: [
        { title: 'Official nutrition', url: 'https://example.com/nutrition' },
        { title: 'Unsafe', url: 'javascript:alert(1)' },
      ],
    });

    expect(result).toEqual(expect.objectContaining({
      provider: 'anthropic',
      name: 'Burrito bowl',
      serving_description: 'one bowl',
      fat_g: 0,
      confidence: 1,
      notes: 'estimate',
    }));
    expect(result.sources).toEqual([{ title: 'Official nutrition', url: 'https://example.com/nutrition' }]);
  });
});
