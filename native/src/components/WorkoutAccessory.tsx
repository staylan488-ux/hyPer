import { router } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import { SymbolView } from 'expo-symbols';
import { Pressable, View } from 'react-native';

import { formatClock } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import { restLeft, useRestStore } from '~/lib/rest';
import { useNow, useSessionModel } from '~/lib/session';
import { useBlanc } from '~/theme/blanc';

import { BlancText } from './BlancText';

/**
 * The live workout above the tab bar, like Music's now-playing bar: what's
 * next, or the rest countdown. Tap to return to the workout. iOS shows two
 * copies (full and inline), so all state comes from the stores.
 */
export function WorkoutAccessory() {
  const c = useBlanc();
  const placement = NativeTabs.BottomAccessory.usePlacement();
  const session = useSessionModel();
  const rest = useRestStore((state) => state.session);
  const now = useNow(1000);
  if (!session) return null;

  const left = restLeft(rest, now);
  const paused = rest?.status === 'paused' && left !== null;
  const resting = rest?.status === 'running' && left !== null && left > 0;
  const status = resting
    ? `Rest ${formatClock(left)}`
    : paused
      ? `Rest paused · ${formatClock(left)}`
      : session.current
        ? `Set ${session.current.index + 1} of ${session.sets.length} · ${session.current.movement.name}`
        : 'All sets done';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${session.dayName}, ${status}. Open workout.`}
      onPress={() => {
        haptics.tap();
        router.navigate('/train');
      }}
      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18 }}>
      {placement === 'inline' ? (
        <BlancText variant="footnote" weight="600" style={{ fontVariant: ['tabular-nums'] }}>
          {(resting || paused) && left !== null ? formatClock(left) : session.dayName}
        </BlancText>
      ) : (
        <>
          <View style={{ flex: 1, minWidth: 0 }}>
            <BlancText variant="footnote" weight="600">
              {session.dayName}
            </BlancText>
            <BlancText variant="footnote" tone="graphite" numberOfLines={1} style={{ fontVariant: ['tabular-nums'] }}>
              {status}
            </BlancText>
          </View>
          <SymbolView name={resting ? 'timer' : paused ? 'pause.fill' : 'play.fill'} size={17} tintColor={c.ink} />
        </>
      )}
    </Pressable>
  );
}
