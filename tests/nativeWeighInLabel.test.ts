import * as dateFns from 'date-fns';
import { describe, expect, it } from 'vitest';

import type { BodyWeightMeasurement } from '@/lib/healthWeights';
import { loadNativeModule } from './helpers/loadNativeModule';

// measuredLabel (native/src/components/WeighInRows.tsx): when a weigh-in was
// taken, as Body weight's latest figure and its Recent list say it. Those have
// no month heading, so a weigh-in from before this year says its year.

const { measuredLabel } = loadNativeModule<{ measuredLabel: (entry: BodyWeightMeasurement, todayKey: string) => string }>(
  'components/WeighInRows.tsx',
  {
    'date-fns': dateFns,
    'react-native': {},
    'react-native-reanimated': {},
    '@/lib/weightDisplayCore': {},
    '~/lib/accessibility': {},
    '~/lib/fuel': { dayKey: (date: Date) => dateFns.format(date, 'yyyy-MM-dd') },
    '~/lib/haptics': {},
    '~/lib/motion': {},
    '~/lib/you': {},
    '~/theme/blanc': {},
    './BlancText': {},
    './Label': {},
    './Row': {},
    './SwipeRow': {},
  },
);

const at = (local: string, source: 'manual' | 'apple_health' = 'manual') =>
  ({ id: local, measured_at: new Date(local).toISOString(), kilograms: 80, source, source_name: source === 'manual' ? 'hyPer' : 'Health' }) as unknown as BodyWeightMeasurement;

describe('when a weigh-in was taken', () => {
  it('says Today, then the month and day within this year', () => {
    expect(measuredLabel(at('2026-11-07T08:00:00'), '2026-11-07')).toBe('Today, 8:00 AM');
    expect(measuredLabel(at('2026-01-04T08:00:00'), '2026-11-07')).toBe('Jan 4, 8:00 AM');
  });

  it('tells the same day in earlier years apart by their year', () => {
    expect(measuredLabel(at('2025-11-06T08:00:00'), '2026-11-07')).toBe('Nov 6, 2025, 8:00 AM');
    expect(measuredLabel(at('2024-11-06T07:30:00', 'apple_health'), '2026-11-07')).toBe('Nov 6, 2024, 7:30 AM · Health');
  });
});
