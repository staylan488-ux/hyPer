import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { parseRestInput } from '@/lib/restTimer';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { Chip } from '~/components/Chip';
import { GlassButton } from '~/components/GlassButton';
import { RollingText } from '~/components/RollingText';
import { announce, spokenClock, useLargeText } from '~/lib/accessibility';
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
import { figureLead, space, useBlanc } from '~/theme/blanc';

/** The web app's presets; anything else is a custom length. */
const PRESETS = [60, 120, 180, 300];

/** Seconds left on the rest just after a button changed it. */
function restLeftNow(): number {
  return restLeft(useRestStore.getState().session, Date.now()) ?? 0;
}

/**
 * Rest between sets, opened from the timer button in Train's header: start one
 * without logging a set, pause it, add time, change a movement's rest length,
 * or end it early.
 */
export default function RestSheet() {
  const c = useBlanc();
  const large = useLargeText();
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
  // A custom length keeps its place while the sheet is open, so picking a preset never moves the chips.
  const [kept, setKept] = useState<number | null>(() => (custom ? length : null));
  const extra = custom ? length : kept;

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
            if (!PRESETS.includes(seconds)) setKept(seconds);
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
  const caption = running ? 'left' : paused ? 'paused' : 'Change length';

  // The buttons' results, for VoiceOver: the figure changes, or the buttons
  // change under its focus, without a word.
  const start = () => {
    startRest(exerciseId);
    announce(`Rest started, ${spokenClock(length)}`);
  };
  const pause = () => {
    pauseRest();
    announce(`Rest paused, ${spokenClock(restLeftNow())} left`);
  };
  const resume = () => {
    resumeRest();
    announce(`Rest resumed, ${spokenClock(restLeftNow())} left`);
  };
  const addTime = () => {
    extendRest(30);
    announce(`${spokenClock(restLeftNow())} left`);
  };
  const end = () => {
    stopRest();
    announce('Rest ended');
  };

  // Magic Tap (a two-finger double tap) pauses or resumes the rest, or
  // starts one, as the sheet's main button does.
  const magicTap = () => {
    haptics.tap();
    if (running) pause();
    else if (paused) resume();
    else start();
  };

  const content = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16 }}>
        <GlassButton symbol="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <BlancText variant="headline" accessibilityRole="header">
            Rest
          </BlancText>
          {movementName ? (
            <BlancText variant="footnote" tone="graphite" numberOfLines={large ? undefined : 1}>
              {movementName}
            </BlancText>
          ) : null}
        </View>
        <View style={{ width: 44 }} />
      </View>

      {/* The big time is the rest length: tap it to type another, like Custom. */}
      <Pressable
        onPress={chooseCustom}
        style={({ pressed }) => ({ alignItems: 'center', marginTop: 18, opacity: pressed ? 0.5 : 1 })}
        accessible
        accessibilityRole="button"
        accessibilityHint="Change the rest length"
        accessibilityLabel={
          running
            ? `${spokenClock(figure)} of rest left`
            : paused
              ? `Rest paused, ${spokenClock(figure)} left`
              : `Rest length, ${spokenClock(figure)}`
        }>
        {/* Counts down like the Clock app's timer: each second rolls. */}
        {/* Centred by its ink: a tabular "1" would otherwise sit the time off to the right. */}
        <RollingText variant="figure" size={84} tone={paused ? 'graphite' : 'ink'} style={{ letterSpacing: -2, textAlign: 'center', marginLeft: figureLead(formatClock(figure), 84) }}>
          {formatClock(figure)}
        </RollingText>
        {/* Stopped, the caption says what a tap does: the length opens to type another. */}
        <BlancText variant="secondary" weight={running || paused ? undefined : '500'} tone={running || paused ? 'graphite' : 'ink'}>
          {caption}
        </BlancText>
      </Pressable>

      {/* Lengths in order: a custom one takes its place among the presets, and a tap on it types another.
          At the accessibility text sizes the lengths wrap onto more lines. */}
      {/* The lengths share one track, as a segmented control's choices do, so the chosen one reads at a glance. */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'center',
          gap: 2,
          marginTop: 22,
          marginHorizontal: space.inset,
          alignSelf: 'center',
          padding: 2,
          borderRadius: 19,
          borderCurve: 'continuous',
          backgroundColor: c.fill,
          ...(large ? { flexWrap: 'wrap' } : null),
        }}>
        {(extra !== null ? [...PRESETS, extra].sort((a, b) => a - b) : PRESETS).map((seconds) =>
          seconds === extra ? (
            <Chip
              key="custom"
              label={formatClock(extra)}
              accessibilityLabel={`Custom, ${spokenClock(extra)}`}
              selected={length === extra}
              tabular
              inTrack
              haptic={false}
              accessibilityHint={length === extra ? 'Type another length' : undefined}
              style={{ minWidth: 58 }}
              onPress={length === extra ? chooseCustom : () => choose(extra)}
            />
          ) : (
            <Chip
              key={seconds}
              label={formatClock(seconds)}
              accessibilityLabel={spokenClock(seconds)}
              selected={length === seconds}
              tabular
              inTrack
              haptic={false}
              style={{ minWidth: 58 }}
              onPress={() => choose(seconds)}
            />
          ),
        )}
        {extra !== null ? null : <Chip label="Custom" tabular inTrack haptic={false} accessibilityHint="Type a rest length" style={{ minWidth: 58 }} onPress={chooseCustom} />}
      </View>

      {/* At the accessibility text sizes the buttons stack, each as wide as the sheet. */}
      <View style={{ flexDirection: large ? 'column' : 'row', gap: 10, marginTop: 24, paddingHorizontal: space.inset }}>
        {running || paused ? (
          <>
            <View style={large ? undefined : { flex: 1 }}>
              <Capsule title="+30 s" variant="quiet" size="large" fill accessibilityLabel="Add 30 seconds" onPress={addTime} />
            </View>
            <View style={large ? undefined : { flex: 1 }}>
              {running ? (
                <Capsule title="Pause" variant="quiet" size="large" fill onPress={pause} />
              ) : (
                <Capsule title="Resume" size="large" fill onPress={resume} />
              )}
            </View>
            <View style={large ? undefined : { flex: 1 }}>
              <Capsule title="End rest" variant={running ? undefined : 'quiet'} size="large" fill onPress={end} />
            </View>
          </>
        ) : (
          <View style={large ? undefined : { flex: 1 }}>
            <Capsule title="Start rest" size="large" fill onPress={start} />
          </View>
        )}
      </View>
    </>
  );

  // The sheet fits its content; at the accessibility text sizes that can be
  // taller than the screen, so it scrolls.
  return large ? (
    <ScrollView onMagicTap={magicTap} style={{ backgroundColor: c.ground }} contentContainerStyle={{ paddingBottom: 36 }}>
      {content}
    </ScrollView>
  ) : (
    // The floating sheet keeps its own inset from the screen's foot: the button needs only its side margin below it.
    <View onMagicTap={magicTap} style={{ backgroundColor: c.ground, paddingBottom: 16 }}>
      {content}
    </View>
  );
}
