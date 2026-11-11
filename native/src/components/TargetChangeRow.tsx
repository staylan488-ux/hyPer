import { useState, type ReactNode } from 'react';
import { Alert, View } from 'react-native';

import { describeTargetChange, shownTargetChange } from '@/lib/targetChanges';
import { useAppStore } from '@/stores/appStore';
import { announce, speak, useLargeText } from '~/lib/accessibility';
import { useCurrentDayKey } from '~/lib/accountData';
import { haptics } from '~/lib/haptics';
import { useWeightStore } from '~/lib/you';

import { BlancText } from './BlancText';
import { Capsule } from './Capsule';

/** Noon of a day key ("2026-11-16"), so the week it falls in never depends on the hour. */
function dayFromKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

/** This week's target change while it is in force, or null: for a screen that groups around it. */
export function useShownTargetChange() {
  const dayKey = useCurrentDayKey();
  const change = useAppStore((state) => state.targetChange);
  const target = useAppStore((state) => state.macroTarget);
  return shownTargetChange(change, target, dayFromKey(dayKey));
}

/**
 * This week's calorie target change, if the adaptive loop made one and it is
 * still in force: one title, one quiet line and Undo, which puts the old
 * target back until next Monday's update. A raise is plain news, never red.
 * Renders nothing when there is no change to show, including on a backend
 * without the change record. `after` (a hairline in a group) shows only with it.
 */
export function TargetChangeRow({ after }: { after?: ReactNode }) {
  const shown = useShownTargetChange();
  const unit = useWeightStore((state) => state.unit);
  const large = useLargeText();
  const [undoing, setUndoing] = useState(false);
  if (!shown) return null;
  const { title, line } = describeTargetChange(shown, unit);

  const undo = async () => {
    if (undoing) return;
    setUndoing(true);
    try {
      const done = await useAppStore.getState().undoTargetChange(shown.change);
      if (done) {
        haptics.success();
        const back = useAppStore.getState().targetChange;
        if (back) {
          const words = describeTargetChange({ change: back, undone: true }, unit);
          announce(`${words.title}. ${words.line}`);
        }
      }
    } catch {
      haptics.error();
      Alert.alert('Not undone', 'Check your connection and try again.');
    } finally {
      setUndoing(false);
    }
  };

  const button = shown.undone ? null : (
    <Capsule title="Undo" variant="quiet" size="small" busy={undoing} accessibilityLabel="Undo target change" onPress={() => void undo()} />
  );

  // Laid out as a list row, but the reason wraps in full (it is what Undo
  // rests on), and VoiceOver reads the title and reason as one, then Undo.
  return (
    <View>
      <View style={{ flexDirection: large ? 'column' : 'row', alignItems: large ? 'flex-start' : 'center', gap: 12, minHeight: 60, paddingVertical: 10, paddingLeft: 18, paddingRight: 16 }}>
        <View accessible accessibilityLabel={speak(`${title}. ${line}`)} style={{ flex: large ? undefined : 1, minWidth: 0, gap: 1 }}>
          <BlancText variant="bodyStrong">{title}</BlancText>
          <BlancText variant="secondary" tone="graphite">
            {line}
          </BlancText>
        </View>
        {button}
      </View>
      {after}
    </View>
  );
}
