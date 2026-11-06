import { useColorScheme } from 'react-native';

import { useIncreaseContrast } from '~/lib/accessibility';

import { muscleTonesFor, type MuscleTones } from './muscleTones';

/** Progress's volume tones for the system appearance, following Increase Contrast. */
export function useMuscleTones(): MuscleTones {
  return muscleTonesFor(useColorScheme() === 'dark', useIncreaseContrast());
}
