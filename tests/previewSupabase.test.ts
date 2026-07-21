import { describe, expect, it } from 'vitest';

import { createMockClient } from '@/preview/mockSupabase';

describe('preview Supabase Edge Functions', () => {
  it('returns deterministic USDA matches for photo review', async () => {
    const client = createMockClient();

    const { data, error } = await client.functions.invoke('food-lookup', {
      body: { action: 'search', query: 'white rice cooked' },
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({
      foods: [{ description: 'White Rice, cooked' }],
    });
  });
});
