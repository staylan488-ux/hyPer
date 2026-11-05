import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { format } from 'date-fns';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { createSimulatedSource, useRunTracker, type PositionSource } from '@/hooks/useRunTracker';
import { gpsScenarios } from '@/lib/gpsScenarios';
import { NativeRun } from '@/lib/nativeBridge';
import {
  AUTO_LAP_OPTIONS,
  DEFAULT_AUTO_LAP,
  DEFAULT_CUSTOM_AUTO_LAP_M,
  RUN_MODE_LABELS,
  RUN_MODE_OPTIONS,
  RUN_STATUS_LABELS,
  autoLapDistanceM,
  finishedRunPace,
  finishedRunSplits,
  formatRunClock,
  formatRunDistance,
  formatRunPace,
  gpsDiagnosticsExport,
  isAutoLapValid,
  livePaceSecPerMile,
  runLocationBlock,
  runSaveErrorMessage,
  runStatus,
  splitFigure,
  splitPaceSecPerMile,
  type AutoLapChoice,
  type RunStatus,
} from '@/lib/runDisplay';
import {
  averagePaceSecPerMile,
  currentLapDistanceM,
  currentLapSeconds,
  elapsedSeconds,
  type FinishedRun,
  type RunMode,
  type TrackerState,
} from '@/lib/runTracker';
import { useAppStore } from '@/stores/appStore';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { FieldRow, FormNote, MenuRow } from '~/components/Form';
import { GlassButton } from '~/components/GlassButton';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { announce, speak, spokenClock, useAnnounce, useLargeText } from '~/lib/accessibility';
import { haptics } from '~/lib/haptics';
import { loadHistoryMonth } from '~/lib/history';
import { holdRunLinks } from '~/lib/launchLink';
import { isPreviewActive } from '~/platform/previewFlag';
import { space, useBlanc } from '~/theme/blanc';

// A GPS run, as the web's /train/run: set up (mode and auto-split), live
// (pace, time, distance; Split, Rest and Hold to finish), then the finished
// run to save or discard. The engine, recovery and recorder rules are shared
// (useRunTracker, lib/runTracker, lib/nativeRunSource); recording goes through
// modules/hyper-run, which keeps going with the screen locked and puts the run
// on the lock screen with Split, Rest and Finish.

type SourceChoice = 'gps' | (typeof gpsScenarios)[number]['id'];
const SIMULATOR_TIME_SCALE = 10;

/**
 * A run reading as VoiceOver should say it: "7:59 /mi" as "7 minutes 59
 * seconds per mile", "1:05 · 200 m" as "1 minute 5 seconds, 200 meters", a
 * dash (no pace yet: "–" on screen, "—" on the lock screen) as "none". For
 * the run's own figures only (a time of day is no clock).
 */
function spokenRun(text: string): string {
  if (text === '—' || text === '–') return 'none';
  return speak(
    text
      .replace(/60:00\+/g, 'over 60 minutes')
      .replace(/\b(?:(\d+):)?(\d+):(\d{2})\b/g, (_match, h: string | undefined, m: string, s: string) =>
        spokenClock(Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s)),
      )
      .replace(/ \/mi\b/g, ' per mile')
      .replace(/—/g, 'none'),
  );
}

const SPOKEN_STATUS: Record<RunStatus, string> = {
  resting: 'Resting',
  acquiring: 'Acquiring GPS',
  weak: 'GPS weak',
  ok: 'GPS OK',
};

export default function RunScreen() {
  useEffect(holdRunLinks, []);
  const tracker = useRunTracker();
  const state = tracker.state;
  const running = state?.status === 'running';

  // The lock screen and Dynamic Island follow every tick (the module sends at
  // most one update every 3 seconds; iOS ticks the clock in between). The
  // widget reads "—" as no pace yet, so these keep the em dash.
  const paceLabel = running ? (formatRunPace(livePaceSecPerMile(state, tracker.nowMs)) ?? '—') : null;
  const averageLabel = running ? (formatRunPace(averagePaceSecPerMile(state, tracker.nowMs)) ?? '—') : null;
  const elapsedS = running ? elapsedSeconds(state, tracker.nowMs) : 0;
  useEffect(() => {
    if (!state || state.status !== 'running' || paceLabel === null || averageLabel === null) return;
    void NativeRun.syncLiveActivity({
      runId: state.runId,
      mode: state.config.mode === 'intervals' ? 'intervals' : 'free',
      distanceM: state.totalDistanceM,
      elapsedS,
      livePace: paceLabel,
      averagePace: averageLabel,
      isResting: tracker.resting,
    }).catch(() => undefined);
  }, [state, elapsedS, paceLabel, averageLabel, tracker.resting]);

  if (tracker.finishedRun) return <Finished run={tracker.finishedRun} discard={tracker.discard} />;
  if (running) return <Live tracker={tracker} state={state} />;
  return <Setup tracker={tracker} />;
}

type Tracker = ReturnType<typeof useRunTracker>;

function close() {
  router.dismiss();
}

/**
 * The run's own top bar: Close, and a title. The screen draws it rather than
 * iOS's header, because a modal that shows and hides its header is rebuilt by
 * iOS, which would drop the run in progress.
 */
function TopBar({ title, onClose = close }: { title?: string; onClose?: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: insets.top + 6, paddingHorizontal: space.inset, paddingBottom: 6 }}>
      <GlassButton symbol="xmark" accessibilityLabel="Close" onPress={onClose} />
      {/* Without a title there is no heading for VoiceOver to stop on. */}
      <BlancText variant="headline" accessible={Boolean(title)} accessibilityRole={title ? 'header' : undefined} style={{ flex: 1, textAlign: 'center' }}>
        {title ?? ''}
      </BlancText>
      <View style={{ width: 44 }} />
    </View>
  );
}

/* ── Before the run ── */

function Setup({ tracker }: { tracker: Tracker }) {
  const c = useBlanc();
  const insets = useSafeAreaInsets();
  const large = useLargeText();
  const preview = isPreviewActive();
  const [mode, setMode] = useState<RunMode>('free');
  const [autoLap, setAutoLap] = useState<AutoLapChoice>(DEFAULT_AUTO_LAP);
  const [customMetres, setCustomMetres] = useState(DEFAULT_CUSTOM_AUTO_LAP_M);
  const [source, setSource] = useState<SourceChoice>(preview ? gpsScenarios[0].id : 'gps');
  const [locationBlocked, setLocationBlocked] = useState<'off' | 'approximate' | null>(null);
  const [starting, setStarting] = useState(false);
  const valid = mode === 'free' || isAutoLapValid(autoLap, customMetres);

  const sourceOptions = useMemo(
    () => [
      { value: 'gps' as SourceChoice, label: 'Real GPS' },
      ...gpsScenarios.map((scenario) => ({ value: scenario.id as SourceChoice, label: `Simulated ${scenario.label.toLowerCase()} (${SIMULATOR_TIME_SCALE}×)` })),
    ],
    [],
  );

  const simulated = (): PositionSource | undefined => {
    const scenario = gpsScenarios.find((candidate) => candidate.id === source);
    return scenario ? createSimulatedSource(scenario.build(), SIMULATOR_TIME_SCALE) : undefined;
  };

  const start = async () => {
    if (tracker.resumable || !valid || starting) return;
    const positions = simulated();
    if (!positions) {
      // Ask for location here, so a refusal shows on this screen with a way
      // to Settings instead of on the live run.
      setStarting(true);
      const permission = await NativeRun.requestPermissions().catch(() => null);
      setStarting(false);
      const blocked = runLocationBlock(permission);
      if (blocked) {
        haptics.error();
        setLocationBlocked(blocked);
        return;
      }
    }
    setLocationBlocked(null);
    tracker.start(mode, mode === 'intervals' ? autoLapDistanceM(autoLap, customMetres) : null, positions);
  };

  const discardInterrupted = () =>
    Alert.alert('Discard the interrupted run?', 'Its distance and splits are deleted.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => tracker.discard() },
    ]);

  const locationMessage = `Location is ${locationBlocked === 'approximate' ? 'approximate' : 'off'} for hyPer. Allow it, with Precise Location, to track runs.`;
  useAnnounce(locationBlocked && locationMessage);

  return (
    <>
      <View style={{ flex: 1, backgroundColor: c.ground }}>
        <TopBar title="Run" />
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
          {tracker.resumable ? (
            <Label style={{ marginTop: 12, paddingHorizontal: 18, paddingVertical: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.live }} />
                <BlancText variant="headline" accessibilityRole="header" style={large ? { flexShrink: 1 } : undefined}>
                  Run in progress
                </BlancText>
              </View>
              <BlancText variant="secondary" tone="graphite" style={{ marginTop: 4 }}>
                It was interrupted. Pick it back up, or discard it to start another.
              </BlancText>
              <Capsule title="Discard" accessibilityLabel="Discard interrupted run" variant="quiet" onPress={discardInterrupted} style={{ marginTop: 14 }} />
            </Label>
          ) : null}

          {/* An interrupted run comes first: resume it or discard it before choosing another. */}
          {tracker.resumable ? null : (
            <View style={{ marginHorizontal: space.inset, marginTop: 12 }}>
              <Host matchContents={{ vertical: true }} style={{ alignSelf: 'stretch' }}>
                <Picker
                  selection={mode}
                  onSelectionChange={(next) => {
                    haptics.select();
                    setMode(next as RunMode);
                  }}
                  modifiers={[pickerStyle('segmented')]}>
                  {RUN_MODE_OPTIONS.map((option) => (
                    <SwiftText key={option.value} modifiers={[tag(option.value)]}>
                      {option.label}
                    </SwiftText>
                  ))}
                </Picker>
              </Host>
            </View>
          )}
          {/* Under a bare control the note starts at the gutter, as on Program. */}
          {tracker.resumable ? null : (
            <BlancText variant="footnote" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 8 }}>
              {mode === 'intervals' ? 'Split on demand or by distance.' : 'Live and average pace.'}
            </BlancText>
          )}

          {mode === 'intervals' && !tracker.resumable ? (
            <Section title="Auto-split">
              <Label>
                <MenuRow
                  label="Split"
                  value={autoLap}
                  options={AUTO_LAP_OPTIONS}
                  onChange={(next) => setAutoLap(next as AutoLapChoice)}
                />
                {autoLap === 'custom' ? (
                  <>
                    <Hairline />
                    <FieldRow
                      label="Distance"
                      unit="m"
                      value={customMetres}
                      onChangeText={(text) => setCustomMetres(text.replace(/[^0-9]/g, ''))}
                      keyboardType="number-pad"
                      invalid={!valid}
                      accessibilityLabel="Custom split distance in metres"
                    />
                  </>
                ) : null}
              </Label>
              <FormNote alert={!valid}>
                {valid ? 'Tap Split anytime, or let distance split for you, hands free.' : 'Enter 10–100,000 m.'}
              </FormNote>
            </Section>
          ) : null}

          {preview && !tracker.resumable ? (
            <Section title="Position">
              <Label>
                <MenuRow label="Source" value={source} options={sourceOptions} onChange={(next) => setSource(next as SourceChoice)} />
              </Label>
              <FormNote>Sample mode only: a simulated route plays at ten times speed.</FormNote>
            </Section>
          ) : null}

          {locationBlocked ? (
            <View style={{ marginTop: 24, marginHorizontal: space.gutter, gap: 12 }}>
              <BlancText variant="secondary" tone="live" accessibilityRole="alert">
                {locationMessage}
              </BlancText>
              <Capsule title="Open Settings" variant="quiet" onPress={() => void Linking.openSettings()} />
            </View>
          ) : tracker.gpsError ? (
            <FormNote alert>{tracker.gpsError}</FormNote>
          ) : null}
        </ScrollView>

        {/* Rides above the keyboard while a split distance is typed, so Start stays in reach. */}
        <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
          <View style={{ paddingHorizontal: space.inset, paddingTop: 8, paddingBottom: insets.bottom + 12, backgroundColor: c.ground }}>
            {tracker.resumable ? (
              <Capsule title="Resume run" size="large" fill onPress={() => tracker.resume()} />
            ) : (
              <Capsule title="Start run" size="large" fill busy={starting} disabled={!valid} onPress={() => void start()} />
            )}
          </View>
        </KeyboardStickyView>
      </View>
    </>
  );
}

/* ── During the run ── */

function Live({ tracker, state }: { tracker: Tracker; state: TrackerState }) {
  const c = useBlanc();
  const insets = useSafeAreaInsets();
  const large = useLargeText();
  const now = tracker.nowMs;
  const intervals = state.config.mode === 'intervals';
  const status = runStatus(state, now);
  // Only weak GPS is a warning; resting and finding GPS are not.
  const alert = status === 'weak';
  // A rest lap has no pace; its clock is the figure worth reading.
  const restHero = tracker.resting && intervals;
  const pace = formatRunPace(livePaceSecPerMile(state, now)) ?? '–';
  const [figure, unit] = restHero ? [formatRunClock(currentLapSeconds(state, now)), ''] : splitFigure(pace);
  const caption = restHero ? 'Rest' : tracker.resting ? 'Paused' : intervals ? 'Lap pace' : 'Pace';
  const lastLap = state.laps.length > 0 ? state.laps[state.laps.length - 1] : null;

  // Split confirms only a lap the tracker took: a tap inside its debounce
  // changes nothing, so it says nothing. The tracker commits a split before
  // the next render, which reads whether one landed.
  const pendingSplit = useRef<{ before: number | null } | null>(null);
  useEffect(() => {
    const pending = pendingSplit.current;
    if (!pending) return;
    pendingSplit.current = null;
    if (state.lastManualSplitMs !== pending.before) haptics.success();
  });

  // VoiceOver hears the GPS line change: on the way in, at the lock (the
  // clock starts there) and when the signal drops or comes back. A rest is
  // the runner's own doing, so neither it nor the resume after it speaks.
  const heardStatus = useRef<RunStatus | null>(null);
  useEffect(() => {
    if (status === 'resting' || status === heardStatus.current) return;
    heardStatus.current = status;
    announce(SPOKEN_STATUS[status]);
  }, [status]);
  useAnnounce(tracker.gpsError);

  // A finished effort shows under Last split, by hand or by distance; VoiceOver
  // says it too, as a running watch does. Rests, and the laps a resumed run
  // already had, say nothing.
  const lapsHeard = useRef(state.laps.length);
  useEffect(() => {
    const count = state.laps.length;
    const lap = count > lapsHeard.current ? state.laps[count - 1] : null;
    lapsHeard.current = count;
    if (!lap || lap.kind !== 'work') return;
    announce(`Split ${lap.index}, ${spokenRun(`${formatRunClock((lap.endedAtMs - lap.startedAtMs) / 1000)} · ${formatRunDistance(lap.distanceM)}`)}`);
  }, [state.laps]);

  const body = (
    <>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: 44,
          paddingHorizontal: space.gutter,
          ...(large ? { flexWrap: 'wrap', columnGap: 12 } : null),
        }}>
        <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8 }, large ? { flexShrink: 1 } : null]}>
          {!tracker.resting ? <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: c.live }} /> : null}
          <BlancText variant="headline" accessibilityRole="header" style={large ? { flexShrink: 1 } : undefined}>
            {RUN_MODE_LABELS[state.config.mode]}
          </BlancText>
        </View>
        <BlancText variant="secondary" tone={alert ? 'live' : 'graphite'} accessibilityLabel={SPOKEN_STATUS[status]}>
          {RUN_STATUS_LABELS[status]}
        </BlancText>
      </View>
      {tracker.gpsError ? (
        <BlancText variant="footnote" tone="live" accessibilityRole="alert" style={{ marginHorizontal: space.gutter, marginTop: 4 }}>
          {tracker.gpsError}
        </BlancText>
      ) : null}

      {/* At the accessibility text sizes this scrolls, so it grows from its content. */}
      <View style={{ ...(large ? { flexGrow: 1, paddingVertical: 16 } : { flex: 1 }), justifyContent: 'center', paddingHorizontal: space.gutter }}>
        {/* One fact for VoiceOver: "Lap pace, 7 minutes 59 seconds per mile". */}
        <View accessible accessibilityLabel={tracker.resting && !restHero ? caption : `${caption}, ${spokenRun(restHero ? figure : pace)}`}>
          <BlancText variant="secondary" tone="graphite">
            {caption}
          </BlancText>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 2, ...(large ? { flexWrap: 'wrap' } : null) }}>
            <BlancText variant="figure" size={104} style={{ letterSpacing: -3, lineHeight: 116 }} numberOfLines={1} adjustsFontSizeToFit>
              {figure}
            </BlancText>
            {unit ? (
              <BlancText variant="body" tone="graphite">
                {unit}
              </BlancText>
            ) : null}
          </View>
        </View>

        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.hairline, marginTop: 28 }} />
        <View style={large ? { marginTop: 16, gap: 14 } : { flexDirection: 'row', marginTop: 16 }}>
          <Stat label="Time" value={formatRunClock(elapsedSeconds(state, now))} />
          <Stat label="Distance" value={formatRunDistance(state.totalDistanceM)} />
          <Stat label="Avg pace" name="Average pace" value={formatRunPace(averagePaceSecPerMile(state, now)) ?? '–'} />
        </View>

        {intervals ? (
          <>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.hairline, marginTop: 20 }} />
            <View style={large ? { marginTop: 16, gap: 14 } : { flexDirection: 'row', marginTop: 16 }}>
              <Detail
                label={tracker.resting ? 'Resting' : `Lap ${state.laps.length + 1}`}
                value={`${formatRunClock(currentLapSeconds(state, now))} · ${formatRunDistance(currentLapDistanceM(state))}`}
              />
              {/* Shown once there is a split to show. */}
              {lastLap ? (
                <Detail
                  label="Last split"
                  value={`${formatRunClock((lastLap.endedAtMs - lastLap.startedAtMs) / 1000)} · ${formatRunDistance(lastLap.distanceM)}`}
                />
              ) : null}
            </View>
          </>
        ) : null}

        {state.config.mode === 'sprints' ? (
          <>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.hairline, marginTop: 20 }} />
            <View style={large ? { marginTop: 16, gap: 14 } : { flexDirection: 'row', marginTop: 16 }}>
              <Detail
                label="Sprints"
                value={`${state.reps.length}${state.sprintPhase === 'active' ? ' ●' : ''}`}
                spoken={`${state.reps.length}${state.sprintPhase === 'active' ? ', sprinting now' : ''}`}
              />
              {state.reps.length > 0 ? (
                <Detail
                  label="Last rep"
                  value={`${formatRunDistance(state.reps[state.reps.length - 1].distanceM)} · ${state.reps[state.reps.length - 1].peakSpeedMps.toFixed(1)} m/s peak`}
                />
              ) : null}
            </View>
          </>
        ) : null}
      </View>
    </>
  );

  return (
    <>
      <View style={{ flex: 1, backgroundColor: c.ground, paddingTop: insets.top + 10, paddingBottom: insets.bottom + 12 }}>
        {large ? (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
            {body}
          </ScrollView>
        ) : (
          body
        )}

        {/* Big controls for running hands; finishing needs a hold. At the
            accessibility text sizes they stack, bottom up, so Rest and the
            finish hold still keep their place while Split is away. */}
        <View style={large ? { gap: 10, paddingHorizontal: space.inset, paddingTop: 12 } : { flexDirection: 'row', gap: 10, paddingHorizontal: space.inset }}>
          {intervals && !tracker.resting ? (
            <BigButton
              title="Split"
              primary
              onPress={() => {
                pendingSplit.current = { before: state.lastManualSplitMs };
                tracker.split();
              }}
            />
          ) : intervals && !large ? (
            // Resting keeps Split's place, so Resume and the finish hold never move under a finger.
            <View style={{ flex: 1 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
          ) : null}
          <BigButton
            title={tracker.resting ? 'Resume' : 'Rest'}
            onPress={() => {
              haptics.tap();
              tracker.toggleRest();
            }}
          />
          <HoldToFinish onFinish={() => tracker.finish()} />
        </View>
      </View>
    </>
  );
}

/**
 * A figure with its label, read by VoiceOver as one fact ("Time, 12 minutes
 * 4 seconds"); `name` is the label in full where it is shortened. At the
 * accessibility text sizes stats stack (their row does), so they take no flex.
 */
function Stat({ label, name, value }: { label: string; name?: string; value: string }) {
  const large = useLargeText();
  const [number, unit] = splitFigure(value);
  return (
    <View style={large ? { minWidth: 0 } : { flex: 1, minWidth: 0 }} accessible accessibilityLabel={`${name ?? label}, ${spokenRun(value)}`}>
      <BlancText variant="footnote" tone="graphite">
        {label}
      </BlancText>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3, marginTop: 2, ...(large ? { flexWrap: 'wrap' } : null) }}>
        <BlancText variant="figure" size={30} style={{ lineHeight: 36 }} numberOfLines={1} adjustsFontSizeToFit>
          {number}
        </BlancText>
        {unit ? (
          <BlancText variant="footnote" tone="graphite">
            {unit}
          </BlancText>
        ) : null}
      </View>
    </View>
  );
}

/** A label over a value, one fact for VoiceOver; `spoken` is the value in words where shorthand won't do. */
function Detail({ label, value, spoken }: { label: string; value: string; spoken?: string }) {
  const large = useLargeText();
  return (
    <View style={large ? { minWidth: 0 } : { flex: 1, minWidth: 0 }} accessible accessibilityLabel={`${label}, ${spoken ?? spokenRun(value)}`}>
      <BlancText variant="footnote" tone="graphite">
        {label}
      </BlancText>
      <BlancText variant="bodyStrong" numberOfLines={large ? undefined : 1} style={{ marginTop: 3, fontVariant: ['tabular-nums'] }}>
        {value}
      </BlancText>
    </View>
  );
}

/** At the accessibility text sizes the run's controls stack: full width, as tall as their words. */
function BigButton({ title, primary, onPress }: { title: string; primary?: boolean; onPress: () => void }) {
  const c = useBlanc();
  const large = useLargeText();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => ({
        ...(large ? { minHeight: 64, paddingVertical: 10, paddingHorizontal: 20 } : { flex: 1, height: 64 }),
        borderRadius: 32,
        borderCurve: 'continuous',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: primary ? c.capsule : c.fill,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}>
      <BlancText variant="headline" tone={primary ? 'onCapsule' : 'ink'} size={18} style={large ? { textAlign: 'center' } : undefined}>
        {title}
      </BlancText>
    </Pressable>
  );
}

const HOLD_TO_FINISH_MS = 800;

/** Finishing ends the run, so it takes a deliberate hold, never a stray tap. */
function HoldToFinish({ onFinish }: { onFinish: () => void }) {
  const c = useBlanc();
  const large = useLargeText();
  const [holding, setHolding] = useState(false);
  const [width, setWidth] = useState(0);
  const progress = useSharedValue(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The fill shows how long is left to hold, so it runs under Reduce Motion
  // too, like iOS's progress bars; skipped, it would read as done at once.
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
    progress.value = withTiming(0, { duration: 150, reduceMotion: ReduceMotion.Never });
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const complete = () => {
    haptics.success();
    onFinish();
  };

  const begin = () => {
    haptics.tap();
    setHolding(true);
    progress.value = withTiming(1, { duration: HOLD_TO_FINISH_MS, easing: Easing.linear, reduceMotion: ReduceMotion.Never });
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      complete();
    }, HOLD_TO_FINISH_MS);
  };

  const fill = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));
  // VoiceOver cannot hold, so its double tap (and its Finish run action) asks
  // instead: a stray one never ends the run.
  const confirmFinish = () =>
    Alert.alert('Finish this run?', undefined, [
      { text: 'Keep running', style: 'cancel' },
      { text: 'Finish', onPress: complete },
    ]);
  const title = holding ? 'Keep holding…' : 'Hold to finish';
  // At the accessibility text sizes both copies of the words wrap alike.
  const words = [{ textAlign: 'center' as const }, large ? { paddingHorizontal: 20 } : null];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Finish run"
      accessibilityHint="Asks before the run ends"
      accessibilityActions={[{ name: 'finish', label: 'Finish run' }]}
      onAccessibilityTap={confirmFinish}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'finish') confirmFinish();
      }}
      onPressIn={begin}
      onPressOut={cancel}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{
        ...(large ? { minHeight: 64, paddingVertical: 10 } : { flex: 1.3, height: 64 }),
        borderRadius: 32,
        borderCurve: 'continuous',
        overflow: 'hidden',
        backgroundColor: c.fill,
        justifyContent: 'center',
      }}>
      <BlancText variant="headline" size={18} style={words}>
        {title}
      </BlancText>
      {/* The hold fills the capsule in ink, the words turning over as it passes them. */}
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, bottom: 0, overflow: 'hidden', backgroundColor: c.capsule }, fill]}>
        <View style={{ width, height: '100%', justifyContent: 'center' }}>
          <BlancText variant="headline" size={18} tone="onCapsule" style={words}>
            {title}
          </BlancText>
        </View>
      </Animated.View>
    </Pressable>
  );
}

/* ── After the run ── */

function Finished({ run, discard }: { run: FinishedRun; discard: () => void }) {
  const c = useBlanc();
  const insets = useSafeAreaInsets();
  const large = useLargeText();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [exportError, setExportError] = useState(false);
  const splits = finishedRunSplits(run);
  const [distance, distanceUnit] = splitFigure(formatRunDistance(run.totalDistanceM));
  useAnnounce(saveError);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await useAppStore.getState().saveTrackedRun(run);
      if (!saved) {
        haptics.error();
        setSaveError('Could not save the run. It stays here until you discard it.');
        return;
      }
      haptics.success();
      announce('Run saved');
      discard();
      // History already open in Train shows again without reading, so read its month here.
      void loadHistoryMonth();
      router.dismiss();
      router.navigate('/train/history');
    } catch (error) {
      haptics.error();
      setSaveError(runSaveErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const confirmDiscard = () => {
    // A save on its way would put the discarded run in History anyway.
    if (saving) return;
    Alert.alert('Discard this run?', 'It is not saved anywhere.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          discard();
          router.dismiss();
        },
      },
    ]);
  };

  const exportDiagnostics = () => {
    setExportError(false);
    const { filename, content } = gpsDiagnosticsExport(run, new Date());
    void NativeRun.shareDiagnostics({ filename, content }).catch(() => {
      haptics.error();
      setExportError(true);
    });
  };

  // Closing an unsaved run says so, and offers what to do with it.
  const closeFinished = () => {
    if (saving) return;
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: 'Save this run?',
        // The tracker keeps a finished run for 7 days (FINISHED_RUN_RECOVERY_MAX_AGE_MS).
        message: 'A run kept for later waits on the run screen for up to a week.',
        options: ['Save run', 'Discard run', 'Keep for later', 'Cancel'],
        destructiveButtonIndex: 1,
        cancelButtonIndex: 3,
      },
      (index) => {
        if (index === 0) void save();
        if (index === 1) confirmDiscard();
        if (index === 2) close();
      },
    );
  };

  return (
    <>
      <View style={{ flex: 1, backgroundColor: c.ground }}>
        <TopBar onClose={closeFinished} />
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
          <View style={{ paddingHorizontal: space.gutter, paddingTop: 8 }}>
            {/* The screen's title, as its top bar has none; days and months in full for VoiceOver. */}
            <BlancText
              variant="secondary"
              tone="graphite"
              accessibilityRole="header"
              accessibilityLabel={`${RUN_MODE_LABELS[run.mode]}, ${format(run.startedAtMs, 'EEEE, MMMM d, h:mm a')}`}>
              {RUN_MODE_LABELS[run.mode]} · {format(run.startedAtMs, 'EEE, MMM d · h:mm a')}
            </BlancText>
            <View
              style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 6, ...(large ? { flexWrap: 'wrap' } : null) }}
              accessible
              accessibilityLabel={`Distance, ${spokenRun(formatRunDistance(run.totalDistanceM))}`}>
              <BlancText variant="figure" size={88} style={{ letterSpacing: -2.5, lineHeight: 98 }}>
                {distance}
              </BlancText>
              <BlancText variant="body" tone="graphite">
                {distanceUnit}
              </BlancText>
            </View>
            <View style={large ? { marginTop: 18, gap: 14 } : { flexDirection: 'row', marginTop: 18 }}>
              <Stat label="Time" value={formatRunClock(run.elapsedS)} />
              <Stat label="Avg pace" name="Average pace" value={finishedRunPace(run) ?? '–'} />
            </View>
          </View>

          {splits.length > 1 ? (
            <Section title="Splits">
              <Label style={{ paddingHorizontal: 18, paddingVertical: 10 }}>
                {splits.map((split, index) => {
                  const pace = split.isRest ? null : formatRunPace(splitPaceSecPerMile(split));
                  return (
                    // At the accessibility text sizes the columns give way to a line that wraps.
                    <View
                      key={`${split.key}-${index}`}
                      accessible
                      accessibilityLabel={
                        split.isRest
                          ? `Rest, ${spokenRun(formatRunClock(split.durationS))}`
                          : `Split ${split.key}, ${spokenRun(`${formatRunClock(split.durationS)} · ${formatRunDistance(split.distanceM)}${pace ? ` · ${pace}` : ''}`)}`
                      }
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, ...(large ? { flexWrap: 'wrap' } : null) }}>
                      <BlancText variant="meta" size={13} tone="graphite" style={large ? undefined : { width: 22 }}>
                        {split.isRest ? '·' : split.key}
                      </BlancText>
                      <BlancText variant="meta" size={14} tone={split.isRest ? 'graphite' : 'ink'} style={large ? undefined : { flex: 1 }}>
                        {formatRunClock(split.durationS)}
                      </BlancText>
                      <BlancText variant="meta" size={14} tone={split.isRest ? 'graphite' : 'ink'} style={large ? undefined : { flex: 1, textAlign: 'right' }}>
                        {split.isRest ? 'Rest' : formatRunDistance(split.distanceM)}
                      </BlancText>
                      <BlancText variant="meta" size={14} tone={split.isRest ? 'graphite' : 'ink'} style={large ? undefined : { width: 96, textAlign: 'right' }}>
                        {split.isRest ? '' : (pace ?? '–')}
                      </BlancText>
                    </View>
                  );
                })}
              </Label>
            </Section>
          ) : null}

          <Section title="More">
            <Label>
              {run.trace && run.trace.length > 0 ? (
                <>
                  <Row title="Export GPS diagnostics" detail="Stays on this phone unless you share it" onPress={exportDiagnostics} />
                  <Hairline />
                </>
              ) : null}
              <Row title="Discard run" destructive disabled={saving} onPress={confirmDiscard} />
            </Label>
            {exportError ? <FormNote alert>Could not open the share sheet. Try again.</FormNote> : null}
          </Section>
        </ScrollView>

        <View style={{ paddingHorizontal: space.inset, paddingTop: 8, paddingBottom: insets.bottom + 12 }}>
          {saveError ? (
            <BlancText variant="footnote" tone="live" accessibilityRole="alert" style={{ marginHorizontal: 4, marginBottom: 10 }}>
              {saveError}
            </BlancText>
          ) : null}
          <Capsule title={saveError ? 'Try again' : 'Save run'} size="large" fill busy={saving} onPress={() => void save()} />
        </View>
      </View>
    </>
  );
}
