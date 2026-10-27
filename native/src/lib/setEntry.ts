// Entering a set's numbers, the same way wherever a set is logged or edited.
import { ActionSheetIOS } from 'react-native';

import { haptics } from './haptics';

export const RPE_CHOICES = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];

/** A typed weight or rep count: zero or more, with a comma read as a decimal point. */
export const parseNumber = (text: string) => {
  const value = Number.parseFloat(text.replace(',', '.'));
  return Number.isFinite(value) && value >= 0 ? value : null;
};

/** Asks how hard the set was: an RPE from 6 to 10, or none. */
export function chooseRpe(onChoose: (rpe: number | null) => void) {
  haptics.tap();
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: 'How hard was that set?',
      options: ['Cancel', ...RPE_CHOICES.map((value) => `RPE ${value}`), 'No RPE'],
      cancelButtonIndex: 0,
    },
    (index) => {
      if (index === 0) return;
      haptics.select();
      onChoose(index <= RPE_CHOICES.length ? RPE_CHOICES[index - 1] : null);
    },
  );
}
