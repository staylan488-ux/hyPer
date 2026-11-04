import { router } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import { SymbolView } from 'expo-symbols';
import { Pressable, View } from 'react-native';

import { speak, spokenClock } from '~/lib/accessibility';
import { formatClock } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import { restLeft, useRestStore } from '~/lib/rest';
import { useNow, useSessionModel } from '~/lib/session';
import { useBlanc } from '~/theme/blanc';

import { BlancText } from './BlancText';

/**
 * The bar's height is iOS's own, so its text grows only a little with the
 * text size (as the tab bar's labels do).
 */
const ACCESSORY_MAX_SCALE = 1.2;

/**
 * The live workout above the tab bar, like Music's now-playing bar: what's
 * next, or the rest countdown. Tap to return to the workout; during a rest the
 * tap also opens the rest panel (pause, +30 s, length, end), as the timer
 * button in Train's header does. iOS shows two copies (full and inline), so
 * all state comes from the stores.
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
  // The set is named as Train's card names it, per movement; the end states use Train's words.
  const status = resting
    ? `Rest ${formatClock(left)}`
    : paused
      ? `Rest paused · ${formatClock(left)}`
      : session.current
        ? `${session.current.movement.name} · Set ${session.current.setNumber} of ${session.current.movement.sets.length}`
        : session.movements.length === 0
          ? 'No movements yet'
          : session.sets.length > 0
            ? 'All sets logged'
            : 'Nothing left to log';
  // The clock in words: "Rest, 1 minute 5 seconds left".
  const spokenStatus = resting
    ? `Rest, ${spokenClock(left)} left`
    : paused
      ? `Rest paused, ${spokenClock(left)} left`
      : status;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={speak(`${session.dayName}, ${spokenStatus}. ${resting || paused ? 'Open rest timer.' : 'Open workout.'}`)}
      onPress={() => {
        haptics.tap();
        router.navigate('/train');
        if (resting || paused) router.push('/rest');
      }}
      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18 }}>
      {placement === 'inline' ? (
        <BlancText variant="footnote" weight="600" maxFontSizeMultiplier={ACCESSORY_MAX_SCALE} style={{ fontVariant: ['tabular-nums'] }}>
          {(resting || paused) && left !== null ? formatClock(left) : session.dayName}
        </BlancText>
      ) : (
        <>
          <View style={{ flex: 1, minWidth: 0 }}>
            <BlancText variant="footnote" weight="600" maxFontSizeMultiplier={ACCESSORY_MAX_SCALE}>
              {session.dayName}
            </BlancText>
            {session.current && !resting && !paused ? (
              // A long name is cut at its end; the set count always shows.
              <View style={{ flexDirection: 'row' }}>
                <BlancText variant="footnote" tone="graphite" numberOfLines={1} maxFontSizeMultiplier={ACCESSORY_MAX_SCALE} style={{ flexShrink: 1 }}>
                  {session.current.movement.name}
                </BlancText>
                <BlancText variant="footnote" tone="graphite" numberOfLines={1} maxFontSizeMultiplier={ACCESSORY_MAX_SCALE} style={{ fontVariant: ['tabular-nums'] }}>
                  {` · Set ${session.current.setNumber} of ${session.current.movement.sets.length}`}
                </BlancText>
              </View>
            ) : (
              <BlancText variant="footnote" tone="graphite" numberOfLines={1} maxFontSizeMultiplier={ACCESSORY_MAX_SCALE} style={{ fontVariant: ['tabular-nums'] }}>
                {status}
              </BlancText>
            )}
          </View>
          <SymbolView name={resting ? 'timer' : paused ? 'pause.fill' : 'play.fill'} size={17} tintColor={c.ink} />
        </>
      )}
    </Pressable>
  );
}
