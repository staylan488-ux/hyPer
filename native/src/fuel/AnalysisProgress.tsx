import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion, withTiming, ZoomIn } from 'react-native-reanimated';

import { trailAnnouncement, type AnalysisTrail, type TrailLine } from '@/lib/analysisProgress';
import { BlancText } from '~/components/BlancText';
import { Label } from '~/components/Label';
import { Section } from '~/components/Section';
import { reduceMotionValue, useAnnounce, useLargeText } from '~/lib/accessibility';
import { formatClock } from '~/lib/format';
import { rowEnter, rowLayout } from '~/lib/motion';
import { useBlanc } from '~/theme/blanc';

/**
 * A meal analysis as it happens, in place of Analyze meal: the step under way
 * on top (a spinner, the time since Analyze was tapped and what it is working
 * on), so it stays in view and in one place, and the steps done so far under
 * it, newest first, ticked in graphite. The steps are the server's own;
 * nothing is shown that did not happen.
 */
export function AnalysisProgress({ trail, startedAt }: { trail: AnalysisTrail; startedAt: number }) {
  const c = useBlanc();
  const large = useLargeText();
  const seconds = useElapsedSeconds(startedAt);
  // Each new step is said once; the ticking time and Gemini's headings are not.
  useAnnounce(trailAnnouncement(trail));
  const current = trail.lines.at(-1);
  const finished = trail.lines.slice(0, -1);
  const spoken = [current ? [current.now, current.detail].filter(Boolean).join(': ') : null, finished.length ? `Done: ${finished.map((line) => line.done).join(', ')}` : null]
    .filter(Boolean)
    .join('. ');

  return (
    <Section title="Analysis">
      <Label layout={rowLayout} style={{ overflow: 'hidden', paddingVertical: 6 }} accessible accessibilityLabel={spoken}>
        {current ? (
          <Animated.View key={current.id} entering={rowEnter} layout={rowLayout} style={{ flexDirection: 'row', gap: 12, paddingVertical: 10, paddingLeft: 18, paddingRight: 16 }}>
            {/* Beside the first line when the words wrap at the largest text sizes. */}
            <View style={[styles.marker, { alignSelf: 'flex-start' }]}>
              <ActivityIndicator size="small" color={c.graphite} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: large ? 'column' : 'row', alignItems: large ? 'flex-start' : 'baseline', gap: large ? 2 : 12 }}>
                <BlancText variant="bodyStrong" numberOfLines={large ? undefined : 1} style={large ? undefined : { flex: 1 }}>
                  {current.now}
                </BlancText>
                <BlancText variant="secondary" tone="graphite" style={{ fontVariant: ['tabular-nums'] }}>
                  {formatClock(seconds)}
                </BlancText>
              </View>
              {current.detail ? <Detail text={current.detail} large={large} /> : null}
            </View>
          </Animated.View>
        ) : null}
        {[...finished].reverse().map((line) => (
          <DoneLine key={line.id} line={line} large={large} />
        ))}
      </Label>
    </Section>
  );
}

function DoneLine({ line, large }: { line: TrailLine; large: boolean }) {
  const c = useBlanc();
  return (
    <Animated.View entering={doneEnter} layout={rowLayout} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6, paddingLeft: 18, paddingRight: 16 }}>
      <Animated.View entering={tickEnter} style={styles.marker}>
        <SymbolView name="checkmark" size={13} weight="semibold" tintColor={c.ink} />
      </Animated.View>
      <BlancText variant="secondary" tone="graphite" numberOfLines={large ? undefined : 1} style={{ flex: 1 }}>
        {line.done}
      </BlancText>
    </Animated.View>
  );
}

/**
 * What the running step is working on. A new detail rises into place as the
 * last one leaves upwards (only fades under Reduce Motion), over a hidden copy
 * of the text that holds the line's height.
 */
function Detail({ text, large }: { text: string; large: boolean }) {
  return (
    <View style={{ marginTop: 2 }}>
      <BlancText variant="secondary" tone="graphite" numberOfLines={large ? undefined : 1} style={{ opacity: 0 }} accessible={false}>
        {text}
      </BlancText>
      <Animated.View key={text} entering={detailIn} exiting={detailOut} style={StyleSheet.absoluteFill}>
        <BlancText variant="secondary" tone="graphite" numberOfLines={large ? undefined : 1} accessible={false}>
          {text}
        </BlancText>
      </Animated.View>
    </View>
  );
}

// A finished step takes the top of the list once the line it replaces has
// slid down (rowLayout, 220 ms), so the two never draw over each other.
const doneEnter = FadeIn.delay(150).duration(180).reduceMotion(ReduceMotion.Never);
const tickEnter = ZoomIn.delay(150).duration(220);

const RISE = 8;
const detailIn = () => {
  'worklet';
  const still = reduceMotionValue.value;
  const timing = { duration: 240, reduceMotion: ReduceMotion.Never };
  return {
    initialValues: { opacity: 0, transform: [{ translateY: still ? 0 : RISE }] },
    animations: { opacity: withTiming(1, timing), transform: [{ translateY: withTiming(0, timing) }] },
  };
};
const detailOut = () => {
  'worklet';
  const still = reduceMotionValue.value;
  const timing = { duration: 180, reduceMotion: ReduceMotion.Never };
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }] },
    animations: { opacity: withTiming(0, timing), transform: [{ translateY: withTiming(still ? 0 : -RISE, timing) }] },
  };
};

/** Whole seconds since `startedAt`, ticking while shown. */
function useElapsedSeconds(startedAt: number): number {
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [startedAt]);
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

const styles = StyleSheet.create({
  // One column for the spinner and the ticks, so the words line up.
  marker: { width: 20, minHeight: 22, alignItems: 'center', justifyContent: 'center' },
});
