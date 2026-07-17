import { describe, expect, it } from 'vitest';
import { normalizeGoogleHealthWeights } from '../supabase/functions/_shared/google-health-data';

describe('Google Health weight normalization', () => {
  it('converts official weightGrams values to kilograms', () => {
    const rows = normalizeGoogleHealthWeights([{
      dataPointName: 'users/1/dataTypes/weight/dataPoints/eufy-1',
      weight: {
        sampleTime: { physicalTime: '2026-07-16T14:05:00Z' },
        weightGrams: 80_286,
      },
    }], 'user-1', '2026-07-16T14:06:00Z');

    expect(rows).toEqual([expect.objectContaining({
      user_id: 'user-1',
      measured_at: '2026-07-16T14:05:00Z',
      weight_kg: 80.286,
      source: 'google_health',
      external_id: 'users/1/dataTypes/weight/dataPoints/eufy-1',
    })]);
  });

  it('creates a stable identity when Google omits a point name', () => {
    const [row] = normalizeGoogleHealthWeights([{
      weight: {
        sampleTime: { physicalTime: '2026-07-16T14:05:00Z' },
        weightGrams: 80_286.4,
      },
    }], 'user-1', '2026-07-16T14:06:00Z');

    expect(row.external_id).toBe('2026-07-16T14:05:00Z:80286');
  });

  it('drops incomplete and physiologically impossible samples', () => {
    const rows = normalizeGoogleHealthWeights([
      { weight: { weightGrams: 80_000 } },
      { weight: { sampleTime: { physicalTime: '2026-07-16T14:05:00Z' }, weightGrams: 0 } },
      { weight: { sampleTime: { physicalTime: '2026-07-16T14:05:00Z' }, weightGrams: 700_000 } },
    ], 'user-1', '2026-07-16T14:06:00Z');

    expect(rows).toEqual([]);
  });
});
