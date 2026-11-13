import { format, isSameMonth, parseISO, startOfWeek, subDays } from 'date-fns';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, View, type AccessibilityActionEvent, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import Svg, { Line } from 'react-native-svg';

import { averageLoggedDays, useWeeklyNutrition, type DailyNutrition } from '@/hooks/useWeeklyNutrition';
import { warnsOverTarget } from '@/lib/fuelSummary';
import { fetchTrainingHours } from '@/lib/trainingHours';
import { doneOfPlanned, muscleProgressRows, plannedShare, programWeekLine, usualWeekLine, weekLine, type MuscleProgressRow } from '@/lib/muscleProgress';
import { plannedWeekDays, programVolume, type UsualWeek } from '@/lib/muscleVolume';
import { readUsualWeek } from '@/lib/usualWeekRead';
import { volumeSets } from '@/lib/weeklyVolume';
import { TRAINING_WEEK, type TrainingHoursPoint } from '@/lib/workoutSessions';
import { initialAppData, useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { Disclosure } from '~/components/Disclosure';
import { Label } from '~/components/Label';
import { MuscleFigure } from '~/components/MuscleFigure';
import { Hairline } from '~/components/Row';
import { Section } from '~/components/Section';
import { TabScroll } from '~/components/TabScroll';
import { useAccountDay, useCurrentDayKey } from '~/lib/accountData';
import { speak, spokenClock, useAnnounce, useLargeText } from '~/lib/accessibility';
import { formatMinutes, formatWhole } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import { useBlanc } from '~/theme/blanc';
import { openTrain } from '~/lib/openTrain';
import { useTodayPlan } from '~/lib/today';
import { Track } from '~/components/Track';

/**
 * Progress: this week's sets by muscle as done of planned, training time over
 * eight weeks, and eating over the seven days before today. Each section names
 * its own span, since they differ. The week says what is done and what is
 * next, never what was missed.
 */
export default function ProgressScreen() {
  const volume = useAppStore((state) => state.weeklyVolume);
  // The account's day, whose week the volume below was read for.
  const dayKey = useAccountDay((state) => state.dayKey);
  // The first read that works always stores a new list (a failed one leaves it
  // as it was), and sign-out puts back initialAppData's, so a different list
  // means this account's week was read, by this screen or any other.
  const volumeRead = useAppStore((state) => state.weeklyVolume !== initialAppData.weeklyVolume);
  // This screen's own read settled and the week is still unread: it failed. Until then the card waits.
  const [volumeFailed, setVolumeFailed] = useState(false);
  const [hours, setHours] = useState<TrainingHoursPoint[] | null>(null);
  // A read that fails says so: with nothing shown yet it offers Retry; over a chart already drawn, the chart stays and a line says it couldn't refresh.
  const [hoursFailed, setHoursFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  // The usual week, read once on opening (and on pull to refresh); a failed read shows nothing rather than an empty week.
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const [usual, setUsual] = useState<UsualWeek | null>(null);
  // The plan: the week's planned days from the program and its schedule, as Today plans them.
  const plan = useTodayPlan();
  const activeSplit = useAppStore((state) => state.activeSplit);
  const workoutMode = useAppStore((state) => state.workoutMode);
  // Pull to refresh reads everything again; the nutrition block remounts to refetch.
  const [round, setRound] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const active = useRef(true);
  const large = useLargeText();
  // The clock's day: past midnight the nutrition block reads again, for the seven days before the new one.
  const todayKey = useCurrentDayKey();

  // A failed read leaves the store as it was rather than throwing, so it is
  // told by the never-read list still being there once the read settles.
  const readVolume = useCallback(async () => {
    await Promise.resolve(useAppStore.getState().calculateWeeklyVolume()).catch(() => {});
    if (active.current) setVolumeFailed(useAppStore.getState().weeklyVolume === initialAppData.weeklyVolume);
  }, []);

  const readUsual = useCallback(async () => {
    if (!userId) return;
    const read = await readUsualWeek(userId, dayKey).catch(() => undefined);
    if (active.current && read !== undefined) setUsual(read);
  }, [userId, dayKey]);

  const load = useCallback(async () => {
    await Promise.all([
      readVolume(),
      readUsual(),
      fetchTrainingHours()
        .then((points) => {
          if (!active.current) return;
          if (points) setHours(points);
          setHoursFailed(!points);
        })
        .catch(() => {
          if (active.current) setHoursFailed(true);
        }),
      useAppStore.getState().fetchMacroTarget(),
    ]);
  }, [readVolume, readUsual]);

  useEffect(() => {
    active.current = true;
    void load().catch(() => {});
    return () => {
      active.current = false;
    };
  }, [load]);

  // VoiceOver hears a failure it can't see happen.
  useAnnounce(hoursFailed ? (hours ? 'Training time couldn’t refresh.' : 'Training time couldn’t load.') : null);
  const musclesFailed = !volumeRead && volumeFailed;
  useAnnounce(musclesFailed ? 'Muscles couldn’t load.' : null);

  const retryVolume = () => {
    setVolumeFailed(false);
    void readVolume();
  };

  const retryHours = async () => {
    setHoursFailed(false);
    const points = await fetchTrainingHours().catch(() => null);
    if (!active.current) return;
    if (points) setHours(points);
    setHoursFailed(!points);
  };

  const refresh = async () => {
    setRefreshing(true);
    setRound((value) => value + 1);
    await load().catch(() => {});
    if (active.current) setRefreshing(false);
  };

  const hasPlan = workoutMode !== 'flexible' && Boolean(activeSplit?.days.length);
  const done = useMemo(() => volumeSets(volume), [volume]);
  const { schedule, scheduleWorkouts, adaptiveSchedulingEnabled } = plan;
  const planned = useMemo(
    () => (hasPlan && activeSplit
      ? programVolume({
        days: plannedWeekDays({
          splitDays: activeSplit.days,
          daysPerWeek: activeSplit.days_per_week,
          schedule,
          scheduleWorkouts,
          adaptiveSchedulingEnabled,
          dayKey,
        }),
      })
      : null),
    [hasPlan, activeSplit, schedule, scheduleWorkouts, adaptiveSchedulingEnabled, dayKey],
  );
  const program = useMemo(() => (hasPlan && activeSplit ? programVolume(activeSplit) : null), [hasPlan, activeSplit]);
  const rows = useMemo(() => muscleProgressRows(done, planned), [done, planned]);
  const muscles = useMemo(() => rows.map((row) => row.muscle), [rows]);

  const pick = (muscle: string | null) => {
    haptics.select();
    setOpen(muscle);
  };
  const chosen = open ? rows.find((row) => row.muscle === open) ?? null : null;
  // What is done and what is next; never what was missed.
  const line = weekLine({ done: plan.weekDone, target: plan.weekTarget, next: plan.upNext?.day_name });
  const caption = chosen ? `${chosen.label} · ${doneOfPlanned(chosen.done, chosen.planned)}` : line ?? 'Nothing logged yet this week';

  return (
    <>
      <Stack.Screen options={{ title: 'Progress' }} />
      <TabScroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
        <Section title="Muscles" note={`Week of ${format(startOfWeek(parseISO(dayKey), TRAINING_WEEK), 'MMMM d')}`} style={{ marginTop: 6 }}>
          {!volumeRead ? (
            // In the figure card's place, with its padding: a spinner while the week is read, or what happened and a way to try again.
            <Label style={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: 15 }}>
              {musclesFailed ? (
                <View style={{ minHeight: FIGURE_SPACE, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                  <BlancText variant="secondary" tone="graphite">
                    Muscles couldn’t load.
                  </BlancText>
                  <Capsule title="Retry" variant="quiet" onPress={retryVolume} />
                </View>
              ) : (
                <Waiting height={FIGURE_SPACE} label="Loading muscles" />
              )}
            </Label>
          ) : rows.length === 0 ? (
            <Label style={{ paddingLeft: 18, paddingRight: 16, paddingVertical: 16, gap: 12 }}>
              <BlancText variant="headline">Nothing trained yet this week</BlancText>
              <BlancText variant="secondary" tone="graphite">
                Log a session and Progress counts each muscle&apos;s sets this week.
              </BlancText>
              <View style={{ alignSelf: 'flex-start' }}>
                <Capsule title="Start training" onPress={openTrain} />
              </View>
            </Label>
          ) : (
            <>
              <Label style={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: 15 }}>
                {/*
                  One line either way, so a tap on a muscle never moves the figure
                  (at the accessibility text sizes it wraps). No announcement when
                  the choice changes: VoiceOver chooses on the figure (which speaks
                  its new value) or on a muscle's row.
                */}
                <BlancText
                  variant="headline"
                  numberOfLines={large ? undefined : 1}
                  style={{ paddingHorizontal: 6, minHeight: 22 }}
                  accessibilityLabel={inWords(caption)}>
                  {caption}
                </BlancText>
                <MuscleFigure done={done} planned={planned} muscles={muscles} selected={open} onPick={pick} />
              </Label>

              {/* Each muscle's sets this week against the plan; a tap opens the program's week and the usual one. */}
              <Label style={{ overflow: 'hidden', marginTop: 12 }}>
                {rows.map((row, index) => (
                  <Animated.View key={row.muscle} layout={LinearTransition.duration(220)}>
                    {index > 0 ? <Hairline /> : null}
                    <MuscleRow
                      row={row}
                      program={program ? program.get(row.muscle) ?? 0 : null}
                      usual={usual?.sets.get(row.muscle)}
                      open={open === row.muscle}
                      onToggle={() => pick(open === row.muscle ? null : row.muscle)}
                    />
                  </Animated.View>
                ))}
              </Label>
            </>
          )}
        </Section>

        <Section title="Training time" note="Last 8 weeks">
          <Label style={{ paddingLeft: 18, paddingRight: 16, paddingVertical: 16 }}>
            {hours ? (
              <>
                <HoursChart points={hours} />
                {hoursFailed ? (
                  <BlancText variant="footnote" tone="graphite" style={{ marginTop: 10 }}>
                    Couldn’t refresh. Pull down to try again.
                  </BlancText>
                ) : null}
              </>
            ) : hoursFailed ? (
              // Not the blank space of a read still running: what happened, and a way to try again.
              <View style={{ minHeight: 150, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                <BlancText variant="secondary" tone="graphite">
                  Training time couldn’t load.
                </BlancText>
                <Capsule title="Retry" variant="quiet" onPress={() => void retryHours()} />
              </View>
            ) : (
              <Waiting height={150} label="Loading training time" />
            )}
          </Label>
        </Section>

        <NutritionSection key={`${round}:${todayKey}`} todayKey={todayKey} />
      </TabScroll>
    </>
  );
}

/**
 * The figure card's space inside its padding: the caption's 22 pt line and
 * the 204 pt figure 6 pt under it (MuscleFigure's default height and head room).
 */
const FIGURE_SPACE = 232;

/**
 * A muscle this week: its name, done of planned, and a Track of the planned
 * sets done (ink, never red: past the plan is still done). Open, it shows the
 * program's week with its band word and, when there is one, the usual week as
 * a plain figure with no band and no comparison.
 */
function MuscleRow({ row, program, usual, open, onToggle }: { row: MuscleProgressRow; program: number | null; usual: number | undefined; open: boolean; onToggle: () => void }) {
  const c = useBlanc();
  const large = useLargeText();
  const figure = doneOfPlanned(row.done, row.planned);
  const share = plannedShare(row.done, row.planned);
  const details = [program !== null ? programWeekLine(row.muscle, program) : null, usualWeekLine(usual)].filter((line): line is string => Boolean(line));
  const spoken = [`${row.label}, ${figure}`, ...(open ? details : [])].join('. ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={details.length ? { expanded: open } : { selected: open }}
      accessibilityLabel={inWords(spoken)}
      onPress={onToggle}
      style={({ pressed }) => ({ paddingLeft: 18, paddingRight: 16, paddingVertical: 12, backgroundColor: pressed ? c.pressed : 'transparent' })}>
      {/* At the accessibility text sizes the figure wraps under a long name. */}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12, ...(large ? { flexWrap: 'wrap', rowGap: 0 } : null) }}>
        {/* The name with a small chevron that turns as the row opens, so the row reads as one that expands. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, ...(large ? { flexShrink: 1 } : { flex: 1 }) }}>
          <BlancText variant="bodyStrong" style={{ flexShrink: 1 }} numberOfLines={large ? undefined : 1}>
            {row.label}
          </BlancText>
          {details.length ? <Disclosure open={open} /> : null}
        </View>
        <BlancText variant="secondary" style={{ fontVariant: ['tabular-nums'] }}>
          {figure}
        </BlancText>
      </View>
      {share !== null ? (
        <View style={{ marginTop: 9 }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Track progress={share} warnOver={false} />
        </View>
      ) : null}
      {open && details.length ? (
        <Animated.View entering={FadeIn.duration(180)} style={{ marginTop: 8, gap: 2 }}>
          {details.map((detail) => (
            <BlancText key={detail} variant="footnote" tone="graphite">
              {detail}
            </BlancText>
          ))}
        </Animated.View>
      ) : null}
    </Pressable>
  );
}

/**
 * Shorthand in words for VoiceOver, with the coaching lines' "~2 sets" as
 * "about 2 sets" and "5/8 sets" as "5 of 8 sets".
 */
function inWords(text: string): string {
  return speak(text.replace(/~(?=\d)/g, 'about ').replace(/(\d)\/(\d)/g, '$1 of $2'));
}

/**
 * A figure with its units, inside a graphite line: the numbers in ink, the
 * units ("h", "min") left graphite, as "1,342 kcal" reads. One run of text,
 * so VoiceOver and the line's wrapping treat it as the parent's.
 */
function FigureWithUnits({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\d[\d,.]*)/).map((part, index) =>
        index % 2 === 1 ? (
          <BlancText key={index} variant="secondary" weight="500">
            {part}
          </BlancText>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** Training time as VoiceOver says it: "1 hour 20 minutes", or "no training", as a week read says it. */
const spokenMinutes = (minutes: number) => (minutes > 0 ? spokenClock(minutes * 60) : 'no training');

/** Between a scale figure and the line it names, as the body-weight chart leaves it. */
const SCALE_GAP = 8;
/**
 * How far a bar's top stays from a line whose figure sits on it, in points:
 * half the figure's line at its largest text size, and a little room.
 */
const SCALE_CLEAR = 12;

/**
 * The scale figure's box, in points: taller than its line at the largest
 * size it grows to (the footnote's 18 pt line at 1.3×), so the figure always
 * has room. A box of no height made iOS shrink the text to fit it, to nothing.
 */
const SCALE_BOX = 26;

/**
 * A chart's scale or target figure, in the system font with lined-up digits as every chart label is:
 * at the right end of the line it names, centred on it as the body-weight
 * chart sets its scale. The card shows behind it, so the line stops just
 * short of the figure while every plot still runs the card's full width and
 * stacked charts line up. `bottom` is its line; `above` lifts it to sit just
 * above `bottom` instead, where a bar would run into it on the line.
 */
function ScaleLabel({ bottom, above = false, children }: { bottom: `${number}%`; above?: boolean; children: string }) {
  const c = useBlanc();
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom,
        height: SCALE_BOX,
        alignItems: 'flex-end',
        // Centred on the line, or resting just above it.
        ...(above ? { marginBottom: 3, justifyContent: 'flex-end' } : { marginBottom: -SCALE_BOX / 2, justifyContent: 'center' }),
      }}>
      {/* Sized to the figure, never shrunk to fit. */}
      <View style={{ paddingLeft: SCALE_GAP, backgroundColor: c.ground }}>
        <BlancText variant="footnote" tone="graphite" numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ fontVariant: ['tabular-nums'] }}>
          {children}
        </BlancText>
      </View>
    </View>
  );
}

/** The target line's dashes and the gaps between them, in points. */
const DASH = '4 3';

/**
 * A dashed line across the plot. iOS draws a dashed border on one side only
 * as a solid line, so the dashes are drawn.
 */
function DashedLine({ bottom, color }: { bottom: `${number}%`; color: string }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom, height: 1 }}>
      <Svg width="100%" height={1}>
        <Line x1="0" y1="0.5" x2="100%" y2="0.5" stroke={color} strokeWidth={1} strokeDasharray={DASH} />
      </Svg>
    </View>
  );
}

/** Between a chart's header line and its plot: room for a figure lifted above the plot's top line. */
const HOURS_GAP = 20;
const MACRO_GAP = 20;
/** The plots' heights, in points. */
const HOURS_PLOT = 110;
const MACRO_PLOT = 72;

/** Between bars, in points: the training chart's weeks and the nutrition charts' days. */
const HOURS_BAR_GAP = 6;
const MACRO_BAR_GAP = 8;

/**
 * The shortest bar a chart draws for any amount, so a small day or week
 * never reads as an empty one.
 */
const MIN_BAR = 4;

/**
 * A week without training is a true zero, not a gap: a bar of no height,
 * drawn as a short tick on the zero line, half the shortest bar's height.
 */
const ZERO_BAR = 2;

/** The mark for nothing recorded. */
const RING = 6;

/**
 * The mark for a column with nothing recorded (a day with no food logged,
 * which isn't 0 kcal): a small hollow ring just above the zero line, so it
 * never reads as a recorded zero (a bar, however short, is something
 * recorded). Training time has no such column: a week without training is 0 h.
 */
function NothingMark({ onPlot = true, read = false }: { onPlot?: boolean; read?: boolean }) {
  const c = useBlanc();
  return (
    <View
      style={{
        ...(onPlot ? { alignSelf: 'center', marginBottom: 2 } : null),
        width: RING,
        height: RING,
        borderRadius: RING / 2,
        borderWidth: 1.25,
        // In ink while its column is the one read, as a read bar is.
        borderColor: read ? c.ink : c.mark,
      }}
    />
  );
}

/**
 * A read still running: one quiet spinner in the space the chart will take,
 * so the card never sits blank. A read that fails says so in its own words.
 */
function Waiting({ height, label }: { height: number; label: string }) {
  const c = useBlanc();
  return (
    <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={c.graphite} accessibilityLabel={label} />
    </View>
  );
}

/**
 * Reading a bar chart one bar at a time, as Body weight's chart reads a day:
 * tap a bar to read it (tap it again to let go), or hold and slide across the
 * bars, and letting go puts the summary back. Sliding straight away is left
 * to the page (scrolling, or iOS's swipe back). The bar read is the chart's
 * value, which VoiceOver speaks as it changes: swiping up and down steps
 * through the bars, the first swipe reading the latest. `keys` names the bars
 * oldest first; `gap` is the room between them, so a finger picks the
 * nearest bar, in a gap too.
 */
function useBarReading(keys: string[], gap: number) {
  const [reading, setReading] = useState<string | null>(null);
  // The bars' width, gaps included, as laid out.
  const [width, setWidth] = useState(0);
  const index = reading === null ? -1 : keys.indexOf(reading);
  // Each bar owns its width and half the gap either side; past either end is the end bar.
  const barAt = (x: number) => {
    if (width <= 0 || keys.length === 0) return null;
    return Math.min(keys.length - 1, Math.max(0, Math.floor(((x + gap / 2) * keys.length) / (width + gap))));
  };
  const select = (x: number) => {
    const at = barAt(x);
    if (at === null) return;
    setReading((current) => {
      if (current !== keys[at]) haptics.select();
      return keys[at];
    });
  };
  // A tap on the bar already read puts the summary back.
  const tap = (x: number) => {
    const at = barAt(x);
    if (at === null) return;
    haptics.select();
    setReading((current) => (current === keys[at] ? null : keys[at]));
  };
  const step = (direction: 1 | -1) => {
    if (keys.length === 0) return;
    const last = keys.length - 1;
    const next = index === -1 ? last : Math.min(last, Math.max(0, index + direction));
    if (next !== index) haptics.select();
    setReading(keys[next]);
  };
  const gesture = Gesture.Exclusive(
    Gesture.Pan()
      .activateAfterLongPress(160)
      .runOnJS(true)
      .onStart((event) => select(event.x))
      .onUpdate((event) => select(event.x))
      // End, not finalize: finalize also runs when a plain tap fails the
      // hold, and would clear the bar the tap just chose.
      .onEnd(() => setReading(null)),
    Gesture.Tap()
      .runOnJS(true)
      .onEnd((event) => tap(event.x)),
  );
  return {
    /** The bar read, or -1 while the chart shows its summary. */
    index,
    gesture,
    /** For the view the bars are laid out in, from the first bar's left edge. */
    onLayout: (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width),
    /** For the chart's one accessible element. */
    adjustable: {
      accessibilityRole: 'adjustable' as const,
      accessibilityActions: [{ name: 'increment' }, { name: 'decrement' }],
      onAccessibilityAction: (event: AccessibilityActionEvent) => {
        if (event.nativeEvent.actionName === 'increment') step(1);
        if (event.nativeEvent.actionName === 'decrement') step(-1);
      },
    },
  };
}

/**
 * The nutrition targets' figures sit in a column of their own at the plot's
 * right, as the body-weight chart sets its scale, so a bar that runs past
 * its target never meets the figure. Wide enough for "2,600" at the largest
 * size the figure grows to.
 */
const TARGET_COLUMN = 56;

/** What the dashed line means, once under the nutrition charts. */
function TargetKey() {
  const c = useBlanc();
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 }}>
      <Svg width={14} height={1}>
        <Line x1="0" y1="0.5" x2="14" y2="0.5" stroke={c.mark} strokeWidth={1} strokeDasharray={DASH} />
      </Svg>
      <BlancText variant="footnote" tone="graphite">
        Target
      </BlancText>
    </View>
  );
}

/** What the ring means, once under the nutrition charts. VoiceOver hears each day's own "nothing logged". */
function NothingKey({ children }: { children: string }) {
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 }}>
      <NothingMark onPlot={false} />
      <BlancText variant="footnote" tone="graphite">
        {children}
      </BlancText>
    </View>
  );
}

/** The top of the training chart: the next whole hour at or above the longest week. */
const hoursScale = (peak: number) => Math.max(60, Math.ceil(peak / 60) * 60);

/**
 * Eight weeks of training time, against a scale in whole hours: this week in
 * ink, past weeks in `mark` (3:1 or more on the card in every palette), so
 * this week leads without the others going faint. A week without training is
 * 0 h, a zero bar: a 2 pt tick on the zero line, so it needs no key. Any week
 * reads in the header line (useBarReading), in ink while it is read; the
 * dates under the plot are its two ends.
 */
function HoursChart({ points }: { points: TrainingHoursPoint[] }) {
  const c = useBlanc();
  const large = useLargeText();
  const top = hoursScale(Math.max(0, ...points.map((point) => point.totalMinutes)));
  const current = points[points.length - 1];
  // The scale's figure sits on its line over the last two weeks' bars; one
  // that reaches up under it lifts it above the line.
  const lifted = (Math.max(0, ...points.slice(-2).map((point) => point.totalMinutes)) / top) * HOURS_PLOT > HOURS_PLOT - SCALE_CLEAR;
  // At the accessibility text sizes a line that no longer fits wraps; the right-hand words stay right.
  const wrap = large ? ({ flexWrap: 'wrap', columnGap: 12 } as const) : null;
  const right = large ? ({ flexGrow: 1, textAlign: 'right' } as const) : undefined;
  const read = useBarReading(points.map((point) => point.weekStart), HOURS_BAR_GAP);
  // The week read; with none, the header reads this week so far.
  const chosen = read.index >= 0 ? points[read.index] : null;
  // The one ink bar: the week read, or else this week.
  const inked = chosen ? read.index : points.length - 1;
  // The week the header reads: the one read, or this week so far.
  const headed = chosen ?? current;
  const spokenValue = chosen
    ? `Week of ${format(parseISO(chosen.weekStart), 'MMMM d')}, ${spokenMinutes(chosen.totalMinutes)}`
    : `Week to date, ${spokenMinutes(current?.totalMinutes ?? 0)}`;
  return (
    <View
      accessible
      accessibilityLabel="Training time, last 8 weeks"
      accessibilityHint={points.length > 0 ? 'Swipe up or down to read a week.' : undefined}
      accessibilityValue={{ text: spokenValue }}
      {...read.adjustable}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', ...wrap }}>
        {/* This week is still under way; a week read is named by its Monday. */}
        <BlancText variant="secondary" tone="graphite">
          {chosen ? `Week of ${chosen.label}` : 'Week to date'}
        </BlancText>
        <BlancText variant="secondary" tone="graphite" style={[{ fontVariant: ['tabular-nums'] }, right]}>
          {(headed?.totalMinutes ?? 0) <= 0 ? 'No training' : <FigureWithUnits text={formatMinutes(headed?.totalMinutes ?? 0)} />}
        </BlancText>
      </View>
      <GestureDetector gesture={read.gesture}>
        <View style={{ height: HOURS_PLOT, marginTop: HOURS_GAP }} onLayout={read.onLayout}>
          {/* The scale's top, named at its right end, and the zero line; a week without training is a zero bar on it. */}
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, backgroundColor: c.hairline }} />
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 1, backgroundColor: c.hairline }} />
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: HOURS_BAR_GAP, height: '100%' }}>
            {points.map((point, index) => (
              <View key={point.weekStart} style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}>
                {point.totalMinutes > 0 ? (
                  <View
                    style={{
                      height: `${(point.totalMinutes / top) * 100}%`,
                      minHeight: MIN_BAR,
                      borderRadius: 3,
                      borderCurve: 'continuous',
                      backgroundColor: index === inked ? c.ink : c.mark,
                    }}
                  />
                ) : (
                  <View style={{ height: ZERO_BAR, borderRadius: ZERO_BAR / 2, backgroundColor: index === inked ? c.ink : c.mark }} />
                )}
              </View>
            ))}
          </View>
          {/* Over the bars, so a bar never covers it. */}
          <ScaleLabel bottom="100%" above={lifted}>
            {formatMinutes(top)}
          </ScaleLabel>
        </View>
      </GestureDetector>
      {/*
        The first week's date and this week's, at the plot's two ends: one
        even step that never runs together (at the accessibility text sizes
        the two wrap). Any other week reads in the header.
      */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, ...wrap }}>
        <BlancText variant="footnote" tone="graphite" style={{ fontVariant: ['tabular-nums'] }}>
          {points[0]?.label}
        </BlancText>
        <BlancText variant="footnote" tone="graphite" style={[right, { fontVariant: ['tabular-nums'] }]}>
          {current?.label}
        </BlancText>
      </View>
    </View>
  );
}

/**
 * The seven days Progress's nutrition charts show: the seven before today
 * (Today and Fuel already show today). Named by its dates, "Oct 29–Nov 4" or,
 * within one month, "Nov 1–7"; spoken in full, "October 29 to November 4".
 */
function weekBefore(todayKey: string) {
  const last = subDays(parseISO(todayKey), 1);
  const first = subDays(last, 6);
  return {
    lastKey: format(last, 'yyyy-MM-dd'),
    written: `${format(first, 'MMM d')}–${format(last, isSameMonth(first, last) ? 'd' : 'MMM d')}`,
    spoken: `${format(first, 'MMMM d')} to ${format(last, 'MMMM d')}`,
  };
}

function NutritionSection({ todayKey }: { todayKey: string }) {
  const week = weekBefore(todayKey);
  const { weeklyNutrition, loading, error } = useWeeklyNutrition(week.lastKey);
  const target = useAppStore((state) => state.macroTarget);
  const goal = useAppStore((state) => state.nutritionProfile?.goal);
  const failed = "Couldn't load your nutrition. Pull down to try again.";
  // The week arrives after the screen does; a failure would pass unheard.
  useAnnounce(!loading && error ? failed : null);
  // How many of the seven days have anything logged, said once for both charts while some are missing.
  const logged = weeklyNutrition.filter((day) => day.calories > 0 || day.protein > 0).length;
  const shown = !loading && !error && logged > 0 && logged < weeklyNutrition.length;
  const note = `${week.written}${shown ? ` · ${logged} ${logged === 1 ? 'day' : 'days'} logged` : ''}`;
  return (
    <Section title="Nutrition" note={note}>
      <Label style={{ paddingLeft: 18, paddingRight: 16, paddingVertical: 16 }}>
        {loading ? (
          <Waiting height={120} label="Loading nutrition" />
        ) : error ? (
          <BlancText variant="secondary" tone="live">
            {failed}
          </BlancText>
        ) : weeklyNutrition.length === 0 ? (
          // Today's meals are in Fuel; a day shows here from the next.
          <BlancText variant="secondary" tone="graphite">
            Days you log in Fuel show here once they’re over.
          </BlancText>
        ) : (
          <View>
            <View style={{ gap: 22 }}>
              <MacroBars days={weeklyNutrition} span={week.spoken} macro="calories" label="Calories" unit="kcal" target={target?.calories ?? 0} warnOver={warnsOverTarget('calories', goal)} />
              <MacroBars days={weeklyNutrition} span={week.spoken} macro="protein" label="Protein" unit="g" target={target?.protein ?? 0} warnOver={warnsOverTarget('protein', goal)} />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 16 }}>
              {(target?.calories ?? 0) > 0 || (target?.protein ?? 0) > 0 ? <TargetKey /> : null}
              {weeklyNutrition.some((day) => day.calories <= 0 || day.protein <= 0) ? <NothingKey>No entry</NothingKey> : null}
            </View>
          </View>
        )}
      </Label>
    </Section>
  );
}

/**
 * One macro across the seven days before today, against its daily target
 * (dashed, named on its line, "2,600 target"). Every day is a past one, so
 * every bar is `mark` (3:1 or more on the card in every palette), and a day
 * with nothing logged is marked by the hollow ring (unlogged isn't 0 kcal). A
 * day well past target is red only where that is a warning for the goal. The
 * header is the daily average of the logged days ("Avg 2,410 kcal"); a single
 * logged day is given as its figure, named by its date ("Nov 3 1,342 kcal"),
 * since an average of one day is no average. How many days are logged is
 * said once, in the section's note. Any day reads in the header line
 * (useBarReading), "Tue, Nov 3 · 2,410 kcal", its bar in ink while it is read.
 */
function MacroBars({
  days,
  span,
  macro,
  label,
  unit,
  target,
  warnOver,
}: {
  days: DailyNutrition[];
  /** The seven days in words, for VoiceOver: "October 29 to November 4". */
  span: string;
  macro: 'calories' | 'protein';
  label: string;
  unit: string;
  target: number;
  warnOver: boolean;
}) {
  const c = useBlanc();
  const large = useLargeText();
  const average = averageLoggedDays(days, macro);
  // The days the average is of.
  const counted = days.filter((day) => day[macro] > 0).length;
  // One day is said plainly, and named, so the figure never reads as a total or an average.
  const singleDay = counted === 1 ? days.find((day) => day[macro] > 0) : undefined;
  const figure = `${formatWhole(average)} ${unit}`;
  const headline = singleDay
    ? `${figure} on ${format(parseISO(singleDay.date), 'MMMM d')}, the only day logged`
    : counted > 0
      ? `${figure}, the daily average of the logged days, ${span}`
      : `none logged, ${span}`;
  const max = Math.max(1, target * 1.3, ...days.map((day) => day[macro]));
  const isOver = (day: DailyNutrition) => warnOver && target > 0 && day[macro] > target * 1.05;
  // The target's figure sits at its line's height in the column at the
  // plot's right, so it names the right height and no bar can reach it.
  const column = target > 0 ? TARGET_COLUMN : 0;
  const read = useBarReading(days.map((day) => day.date), MACRO_BAR_GAP);
  // The day read; with none, the header reads the average.
  const chosen = read.index >= 0 ? days[read.index] : null;
  const spokenValue = speak(
    chosen
      ? `${format(parseISO(chosen.date), 'EEEE, MMMM d')}, ${chosen[macro] > 0 ? `${formatWhole(chosen[macro])} ${unit}` : 'nothing logged'}${isOver(chosen) ? ', over' : ''}`
      : `${headline}${target > 0 ? ` · target ${formatWhole(target)}` : ''}`,
  );
  return (
    <View
      accessible
      accessibilityLabel={label}
      accessibilityHint={days.length > 0 ? 'Swipe up or down to read a day.' : undefined}
      accessibilityValue={{ text: spokenValue }}
      {...read.adjustable}>
      {/* At the accessibility text sizes the average wraps under the name. */}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', ...(large ? { flexWrap: 'wrap', columnGap: 12 } : null) }}>
        <BlancText variant="secondary" tone="graphite">
          {label}
        </BlancText>
        {chosen ? (
          // The dot stays with the date when the line wraps at the largest text sizes.
          <BlancText variant="secondary" tone="graphite" style={{ fontVariant: ['tabular-nums'] }}>
            {format(parseISO(chosen.date), 'EEE, MMM d')}
            {'\u00a0· '}
            {chosen[macro] > 0 ? (
              <>
                <BlancText variant="secondary" weight="500">
                  {formatWhole(chosen[macro])}
                </BlancText>{' '}
                {unit}
              </>
            ) : (
              'Nothing logged'
            )}
          </BlancText>
        ) : singleDay ? (
          <BlancText variant="secondary" tone="graphite" style={{ fontVariant: ['tabular-nums'] }}>
            {format(parseISO(singleDay.date), 'MMM d')}{' '}
            <BlancText variant="secondary" weight="500">
              {formatWhole(average)}
            </BlancText>{' '}
            {unit}
          </BlancText>
        ) : counted > 0 ? (
          <BlancText variant="secondary" tone="graphite" style={{ fontVariant: ['tabular-nums'] }}>
            Avg{' '}
            <BlancText variant="secondary" weight="500">
              {formatWhole(average)}
            </BlancText>{' '}
            {unit}
          </BlancText>
        ) : (
          <BlancText variant="secondary" tone="graphite">
            None logged
          </BlancText>
        )}
      </View>
      <GestureDetector gesture={read.gesture}>
        <View style={{ height: MACRO_PLOT, marginTop: MACRO_GAP, flexDirection: 'row' }}>
          <View style={{ flex: 1 }} onLayout={read.onLayout}>
            {/* The zero line; a day with nothing logged draws the ring for nothing recorded (an unlogged day isn't 0 kcal). */}
            <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 1, backgroundColor: c.hairline }} />
            {/* The target in `mark`, at full strength: read, but never ahead of the bars. */}
            {target > 0 ? <DashedLine bottom={`${(target / max) * 100}%`} color={c.mark} /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: MACRO_BAR_GAP, height: '100%' }}>
              {days.map((day, index) => (
                <View key={day.date} style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}>
                  {day[macro] > 0 ? (
                    <View
                      style={{
                        height: `${(day[macro] / max) * 100}%`,
                        minHeight: MIN_BAR,
                        borderRadius: 3,
                        borderCurve: 'continuous',
                        // The day read in ink, over target or not: the header says its figure.
                        backgroundColor: index === read.index ? c.ink : isOver(day) ? c.live : c.mark,
                      }}
                    />
                  ) : (
                    <NothingMark read={index === read.index} />
                  )}
                </View>
              ))}
            </View>
          </View>
          {target > 0 ? (
            <View style={{ width: column }}>
              <ScaleLabel bottom={`${(target / max) * 100}%`}>{formatWhole(target)}</ScaleLabel>
            </View>
          ) : null}
        </View>
      </GestureDetector>
      <View style={{ flexDirection: 'row', gap: MACRO_BAR_GAP, marginTop: 6, marginRight: column }}>
        {days.map((day) => (
          <BlancText key={day.date} variant="footnote" tone="graphite" style={{ flex: 1, textAlign: 'center' }}>
            {format(parseISO(day.date), 'EEEEE')}
          </BlancText>
        ))}
      </View>
    </View>
  );
}
