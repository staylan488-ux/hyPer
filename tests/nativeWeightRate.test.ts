import { describe, expect, it } from 'vitest';

import { weeklyRateLabel } from '@/lib/bodyWeightSummary';
import { summaryRateLabel } from '../native/src/lib/weightRate';

describe('The weekly rate a summary shows', () => {
  it('reads to one decimal, signed, in the chosen unit', () => {
    // 0.145 kg a week is 0.32 lb: the shared label's two decimals, one here.
    expect(weeklyRateLabel(0.145, 'lb')).toBe('+0.32 lb/wk');
    expect(summaryRateLabel(0.145, 'lb')).toBe('+0.3 lb/wk');
    expect(summaryRateLabel(-0.5, 'kg')).toBe('−0.5 kg/wk');
  });

  it('has no sign when it rounds to flat, and nothing without a rate', () => {
    expect(summaryRateLabel(0.02, 'lb')).toBe('0.0 lb/wk');
    expect(summaryRateLabel(-0.02, 'kg')).toBe('0.0 kg/wk');
    expect(summaryRateLabel(null, 'lb')).toBeNull();
    expect(summaryRateLabel(Number.NaN, 'lb')).toBeNull();
  });
});
