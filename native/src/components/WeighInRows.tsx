import { format } from 'date-fns';
import { useState, type ReactNode } from 'react';
import { ActionSheetIOS, Alert, View } from 'react-native';
import Animated from 'react-native-reanimated';

import type { BodyWeightMeasurement } from '@/lib/healthWeights';
import { formatWeight, type WeightUnit } from '@/lib/weightDisplayCore';
import { announce } from '~/lib/accessibility';
import { dayKey } from '~/lib/fuel';
import { haptics } from '~/lib/haptics';
import { rowEnter, rowExit, rowLayout } from '~/lib/motion';
import { deleteWeighIn } from '~/lib/you';
import { useBlanc } from '~/theme/blanc';

import { Label } from './Label';
import { Hairline, Row } from './Row';
import { SwipeRow } from './SwipeRow';

/** "Today, 8:00 AM", "Oct 4, 8:00 AM", with the app it came from when it wasn't typed here. */
export function measuredLabel(entry: BodyWeightMeasurement, todayKey: string): string {
  const date = new Date(entry.measured_at);
  const when = `${dayKey(date) === todayKey ? 'Today' : format(date, 'MMM d')}, ${format(date, 'h:mm a')}`;
  return entry.source === 'manual' ? when : `${when} · ${entry.source_name}`;
}

/**
 * Weigh-ins in one card, newest first. A typed one swipes to delete, holds
 * for the same, and a tap asks; Apple Health's stay in Health. `footer` ends
 * the card (Body weight's All weigh-ins row).
 */
export function WeighInRows({
  entries,
  unit,
  todayKey,
  footer,
}: {
  entries: BodyWeightMeasurement[];
  unit: WeightUnit;
  /** Handed down, so "Today" moves on at midnight. */
  todayKey: string;
  footer?: ReactNode;
}) {
  const c = useBlanc();
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());

  const remove = (entry: BodyWeightMeasurement) => {
    setLeaving((current) => new Set(current).add(entry.id));
    void deleteWeighIn(entry).then((deleted) => {
      if (deleted) {
        haptics.success();
        // The row folds away from under VoiceOver's focus.
        announce('Weigh-in deleted');
      } else {
        haptics.error();
        Alert.alert('Not deleted', 'Check your connection and try again.');
      }
      setLeaving((current) => {
        const next = new Set(current);
        next.delete(entry.id);
        return next;
      });
    });
  };

  const menu = (entry: BodyWeightMeasurement) => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: `${formatWeight(Number(entry.kilograms), unit)} ${unit}`,
        message: measuredLabel(entry, todayKey),
        options: ['Delete weigh-in', 'Cancel'],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      (index) => {
        if (index === 0) remove(entry);
      },
    );
  };

  const shown = entries.filter((entry) => !leaving.has(entry.id));
  return (
    <Label style={{ overflow: 'hidden' }} layout={rowLayout}>
      {shown.map((entry, index) => {
        const title = `${formatWeight(Number(entry.kilograms), unit)} ${unit}`;
        const row = (
          <View style={{ backgroundColor: c.label }}>
            <Row
              title={title}
              detail={measuredLabel(entry, todayKey)}
              menu={entry.source === 'manual' ? [{ title: 'Delete weigh-in', symbol: 'trash', destructive: true, removes: true, run: () => remove(entry) }] : undefined}
              onPress={entry.source === 'manual' ? () => menu(entry) : undefined}
            />
          </View>
        );
        return (
          <Animated.View key={entry.id} entering={rowEnter} exiting={rowExit} layout={rowLayout}>
            {index > 0 ? <Hairline /> : null}
            {entry.source === 'manual' ? (
              <SwipeRow name={title} actions={[{ label: 'Delete', destructive: true, onPress: () => remove(entry) }]}>
                {row}
              </SwipeRow>
            ) : (
              row
            )}
          </Animated.View>
        );
      })}
      {footer ? (
        <Animated.View layout={rowLayout}>
          {shown.length > 0 ? <Hairline /> : null}
          {footer}
        </Animated.View>
      ) : null}
    </Label>
  );
}
