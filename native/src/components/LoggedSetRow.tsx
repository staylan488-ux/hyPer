import { SymbolView } from 'expo-symbols';
import { View } from 'react-native';

import type { WorkoutSet } from '@/types';
import { useLargeText } from '~/lib/accessibility';
import { formatSet } from '~/lib/format';
import { useBlanc } from '~/theme/blanc';

import { BlancText } from './BlancText';
import type { MenuAction } from './HoldMenu';
import { Row } from './Row';

type LoggedSetRowProps = {
  /** 1-based place in the movement: "Set 2". */
  number: number;
  set: Pick<WorkoutSet, 'weight' | 'reps' | 'rpe' | 'completed'>;
  /** The gain when this set beat the same set last time ("+5 lb"): an ↑ before the numbers. */
  gain?: string | null;
  /** Keep the RPE column even on a row without one, so numbers line up down the list. */
  rpeColumn?: boolean;
  /** Opens the set to correct it. */
  onPress: () => void;
  /** What a hold offers (Edit, Delete set), as on a Row. */
  menu?: MenuAction[];
  /** Another set is being corrected: dimmed and inert for now. */
  disabled?: boolean;
};

/**
 * A logged set in a list: "Set 2", then "100 lb × 8" in ink and its RPE in a
 * right-hand column of its own. The press highlight and hold menu say it can
 * be corrected, so it carries no pencil. Put it inside a SwipeRow for Delete.
 */
export function LoggedSetRow({ number, set, gain, rpeColumn, onPress, menu, disabled }: LoggedSetRowProps) {
  const c = useBlanc();
  // At the accessibility text sizes the numbers wrap under "Set 2" instead of crowding it.
  const large = useLargeText();
  const logged = set.weight !== null && set.reps !== null;
  const numbers = logged ? formatSet(set.weight, set.reps) : 'Not logged';
  // Graphite numbers on an unfinished set say "not done" by sight only.
  const label = `Set ${number}, ${numbers}${set.rpe ? `, RPE ${set.rpe}` : ''}${logged && !set.completed ? ', not done' : ''}${gain ? `, beat last time, ${gain}` : ''}. Edit`;
  if (large) {
    return (
      <Row
        title={`Set ${number}`}
        detail={[numbers, set.rpe ? `RPE ${set.rpe}` : null].filter(Boolean).join(' · ')}
        detailMark={gain ? <SymbolView name="arrow.up" size={11} weight="bold" tintColor={c.ink} /> : undefined}
        quiet={!set.completed}
        onPress={onPress}
        menu={menu}
        disabled={disabled}
        accessibilityLabel={label}
      />
    );
  }
  return (
    <Row
      title={`Set ${number}`}
      quiet={!set.completed}
      onPress={onPress}
      menu={menu}
      disabled={disabled}
      accessibilityLabel={label}
      trailing={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {gain ? <SymbolView name="arrow.up" size={11} weight="bold" tintColor={c.ink} /> : null}
            <BlancText variant="secondary" weight={logged ? '500' : undefined} tone={logged ? 'ink' : 'graphite'} style={{ fontVariant: ['tabular-nums'] }}>
              {numbers}
            </BlancText>
          </View>
          {set.rpe || rpeColumn ? (
            <BlancText variant="secondary" tone="graphite" style={{ minWidth: 58, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
              {set.rpe ? `RPE ${set.rpe}` : ''}
            </BlancText>
          ) : null}
        </View>
      }
    />
  );
}
