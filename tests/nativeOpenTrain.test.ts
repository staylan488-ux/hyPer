import { describe, expect, it, vi } from 'vitest';

import { loadNativeModule } from './helpers/loadNativeModule';

describe('opening the workout in Train', () => {
  it('switches to Train and pops its stack back to the top, rather than stacking Train again', () => {
    const navigate = vi.fn();
    const { openTrain } = loadNativeModule<{ openTrain: () => void }>('lib/openTrain.ts', {
      'expo-router': { router: { navigate } },
    });
    openTrain();
    expect(navigate).toHaveBeenCalledWith('/train', { __internal__popToNavigator: true });
  });
});
