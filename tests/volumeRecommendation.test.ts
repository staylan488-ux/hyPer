import { describe, expect, it } from 'vitest';

import { getVolumeRecommendation } from '@/lib/splitTemplates';

describe('getVolumeRecommendation', () => {
  const landmark = { mev: 6, mav_low: 10, mav_high: 16, mrv: 20 };

  it('flags below MEV volumes', () => {
    expect(getVolumeRecommendation(5, landmark).status).toBe('below_mev');
  });

  it('flags maintenance-to-MAV-low volumes', () => {
    expect(getVolumeRecommendation(8, landmark).status).toBe('mev_mav');
  });

  it('flags MAV range volumes', () => {
    expect(getVolumeRecommendation(12, landmark).status).toBe('mav');
  });

  it('flags approaching MRV volumes', () => {
    expect(getVolumeRecommendation(18, landmark).status).toBe('approaching_mrv');
  });

  it('flags above MRV volumes', () => {
    expect(getVolumeRecommendation(21, landmark).status).toBe('above_mrv');
  });
});
