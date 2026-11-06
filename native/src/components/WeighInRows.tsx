import { format } from 'date-fns';
import { useState, type ReactNode } from 'react';
import { Alert, View } from 'react-native';
import Animated from 'react-native-reanimated';

import type { BodyWeightMeasurement } from '@/lib/healthWeights';
import { formatWeight, type WeightUnit } from '@/lib/weightDisplayCore';
import { announce, speak, useLargeText } from '~/lib/accessibility';
import { dayKey } from '~/lib/fuel';
import { haptics } from '~/lib/haptics';
import { rowEnter, rowExit, rowLayout } from '~/lib/motion';
import { deleteWeighIn } from '~/lib/you';
import { useBlanc } from '~/theme/blanc';

import { BlancText } from './BlancText';
import type { MenuAction } from './HoldMenu';
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
 * Weigh-ins in one card, newest first, one line each as Health's own data
 * lists read: when, in graphite, and the weight at the right in ink, its
 * digits lined up for comparing down the column. At the accessibility text
 * sizes each row stacks the weight over when. A typed one swipes to delete,
 * holds for the same, and a tap asks; Apple Health's stay in Health.
 * `footer` ends the card (Body weight's All weigh-ins row).
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
  const large = useLargeText();
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

  const shown = entries.filter((entry) => !leaving.has(entry.id));
  return (
    <Label style={{ overflow: 'hidden' }} layout={rowLayout}>
      {shown.map((entry, index) => {
        const title = `${formatWeight(Number(entry.kilograms), unit)} ${unit}`;
        const when = measuredLabel(entry, todayKey);
        const manual = entry.source === 'manual';
        const actions: { menu?: MenuAction[]; onPress?: () => void } = manual
          // Delete lives in the swipe and the hold; a plain tap doesn't open a sheet whose only choice is Delete.
          ? { menu: [{ title: 'Delete weigh-in', symbol: 'trash', destructive: true, removes: true, run: () => remove(entry) }] }
          : {};
        const row = (
          <View style={{ backgroundColor: c.label }}>
            {large ? (
              // Stacked at the accessibility sizes, so neither the weight nor when is cut short.
              <Row title={title} detail={when} {...actions} />
            ) : (
              <WeighInLine title={title} when={when} {...actions} />
            )}
          </View>
        );
        return (
          <Animated.View key={entry.id} entering={rowEnter} exiting={rowExit} layout={rowLayout}>
            {index > 0 ? <Hairline /> : null}
            {manual ? (
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

/**
 * One weigh-in on one 52 pt line. A typed one is a button (Row speaks it as
 * one stop); one from Apple Health is grouped here, since the weight beside
 * Row's text would otherwise be a second stop.
 */
function WeighInLine({ title, when, menu, onPress }: { title: string; when: string; menu?: MenuAction[]; onPress?: () => void }) {
  const label = `${title}, ${when}`;
  const row = (
    <Row
      title={when}
      quiet
      accessibilityLabel={label}
      trailing={
        // The measurement leads the line; its date recedes in graphite.
        <BlancText variant="bodyStrong" style={{ fontVariant: ['tabular-nums'] }}>
          {title}
        </BlancText>
      }
      menu={menu}
      onPress={onPress}
    />
  );
  // A typed weigh-in's row speaks for itself with its hold actions; one from Apple Health is grouped here.
  return onPress || menu ? (
    row
  ) : (
    <View accessible accessibilityLabel={speak(label)}>
      {row}
    </View>
  );
}
