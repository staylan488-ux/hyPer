import { router } from 'expo-router';
import { Alert, Pressable, View } from 'react-native';

import { parseRestInput } from '@/lib/restTimer';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { GlassButton } from '~/components/GlassButton';
import { formatClock } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import {
  extendRest,
  pauseRest,
  restLeft,
  restSecondsFor,
  resumeRest,
  setRestLength,
  startRest,
  stopRest,
  useRestStore,
} from '~/lib/rest';
import { useNow, useSessionModel } from '~/lib/session';
import { space, useBlanc } from '~/theme/blanc';

/** The web app's presets; anything else is a custom length. */
const PRESETS = [60, 120, 180, 300];

/**
 * Rest between sets, opened from the timer button in Train's header: start one
 * without logging a set, pause it, add time, change a movement's rest length,
 * or end it early.
 */
export default function RestSheet() {
  const c = useBlanc();
  const now = useNow(250);
  const session = useSessionModel();
  const rest = useRestStore((state) => state.session);
  const prefs = useRestStore((state) => state.prefs);
  const chosen = useRestStore((state) => state.chosen);

  const left = restLeft(rest, now);
  const paused = rest?.status === 'paused' && left !== null;
  const running = rest?.status === 'running' && left !== null && left > 0;
  // A rest in progress belongs to the movement it follows; otherwise the next one.
  const exerciseId = running || paused ? (rest?.exerciseId ?? null) : (session?.current?.movement.exerciseId ?? null);
  const movementName = session?.movements.find((movement) => movement.exerciseId === exerciseId)?.name ?? null;
  // The movement's saved length; +30 s changes only this rest.
  const length = restSecondsFor(exerciseId, prefs, chosen);
  const custom = !PRESETS.includes(length);

  const choose = (seconds: number) => {
    haptics.select();
    setRestLength(exerciseId, seconds);
  };

  const chooseCustom = () => {
    haptics.tap();
    Alert.prompt(
      'Rest length',
      'Minutes, or minutes and seconds like 1:30.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Set',
          onPress: (value?: string) => {
            const seconds = parseRestInput(value ?? '');
            if (seconds === null) {
              haptics.error();
              Alert.alert('Not a rest length', 'Use 0:05 to 60:00, like 1:30 or 4.');
              return;
            }
            choose(seconds);
          },
        },
      ],
      'plain-text',
      formatClock(length),
      'numbers-and-punctuation',
    );
  };

  const figure = running || paused ? left : length;
  const caption = running ? 'left' : paused ? 'paused' : 'Rest length';

  return (
    <View style={{ backgroundColor: c.ground, paddingBottom: 36 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16 }}>
        <GlassButton symbol="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <BlancText variant="headline" accessibilityRole="header">
            Rest
          </BlancText>
          {movementName ? (
            <BlancText variant="footnote" tone="graphite" numberOfLines={1}>
              {movementName}
            </BlancText>
          ) : null}
        </View>
        <View style={{ width: 44 }} />
      </View>

      <View
        style={{ alignItems: 'center', marginTop: 18 }}
        accessible
        accessibilityLabel={
          running
            ? `${formatClock(figure)} of rest left`
            : paused
              ? `Rest paused, ${formatClock(figure)} left`
              : `Rest length ${formatClock(figure)}`
        }
        accessibilityLiveRegion="polite">
        <BlancText
          variant="figure"
          size={84}
          tone={paused ? 'graphite' : 'ink'}
          style={{ letterSpacing: -2 }}>
          {formatClock(figure)}
        </BlancText>
        <BlancText variant="secondary" tone="graphite">
          {caption}
        </BlancText>
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 22, paddingHorizontal: space.inset }}>
        {PRESETS.map((preset) => (
          <Chip key={preset} label={formatClock(preset)} selected={length === preset} onPress={() => choose(preset)} />
        ))}
        <Chip label={custom ? formatClock(length) : 'Custom'} selected={custom} onPress={chooseCustom} />
      </View>

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 24, paddingHorizontal: space.inset }}>
        {running || paused ? (
          <>
            <View style={{ flex: 1 }}>
              <Capsule
                title="+30 s"
                variant="quiet"
                size="large"
                fill
                accessibilityLabel="Add 30 seconds"
                onPress={() => extendRest(30)}
              />
            </View>
            <View style={{ flex: 1 }}>
              {running ? (
                <Capsule title="Pause" variant="quiet" size="large" fill onPress={pauseRest} />
              ) : (
                <Capsule title="Resume" size="large" fill onPress={resumeRest} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Capsule title="End rest" variant={running ? undefined : 'quiet'} size="large" fill onPress={stopRest} />
            </View>
          </>
        ) : (
          <View style={{ flex: 1 }}>
            <Capsule title="Start rest" size="large" fill onPress={() => startRest(exerciseId)} />
          </View>
        )}
      </View>
    </View>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const c = useBlanc();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      hitSlop={{ top: 5, bottom: 5 }}
      style={({ pressed }) => ({
        height: 36,
        minWidth: 58,
        paddingHorizontal: 12,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: selected ? c.capsule : pressed ? c.pressed : c.fill,
      })}>
      <BlancText variant="footnote" weight="600" tone={selected ? 'onCapsule' : 'ink'} style={{ fontVariant: ['tabular-nums'] }}>
        {label}
      </BlancText>
    </Pressable>
  );
}
