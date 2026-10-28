import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { pickerStyle, tag, tint } from '@expo/ui/swift-ui/modifiers';
import { format } from 'date-fns';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
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
  runSaveErrorMessage,
  runStatus,
  splitFigure,
  splitPaceSecPerMile,
  type AutoLapChoice,
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
import { FieldRow, FormNote } from '~/components/Form';
import { GlassButton } from '~/components/GlassButton';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { haptics } from '~/lib/haptics';
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

export default function RunScreen() {
  const tracker = useRunTracker();
  const state = tracker.state;
  const running = state?.status === 'running';

  // The lock screen and Dynamic Island follow every tick (the module sends at
  // most one update every 3 seconds; iOS ticks the clock in between).
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
function TopBar({ title }: { title?: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: insets.top + 6, paddingHorizontal: space.inset, paddingBottom: 6 }}>
      <GlassButton symbol="xmark" accessibilityLabel="Close" onPress={close} />
      <BlancText variant="headline" accessibilityRole="header" style={{ flex: 1, textAlign: 'center' }}>
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
  const preview = isPreviewActive();
  const [mode, setMode] = useState<RunMode>('free');
  const [autoLap, setAutoLap] = useState<AutoLapChoice>(DEFAULT_AUTO_LAP);
  const [customMetres, setCustomMetres] = useState(DEFAULT_CUSTOM_AUTO_LAP_M);
  const [source, setSource] = useState<SourceChoice>(preview ? gpsScenarios[0].id : 'gps');
  const [locationBlocked, setLocationBlocked] = useState(false);
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
      if (permission && (permission.location === 'denied' || permission.location === 'restricted')) {
        haptics.error();
        setLocationBlocked(true);
        return;
      }
    }
    setLocationBlocked(false);
    tracker.start(mode, mode === 'intervals' ? autoLapDistanceM(autoLap, customMetres) : null, positions);
  };

  const discardInterrupted = () =>
    Alert.alert('Discard the interrupted run?', 'Its distance and splits are deleted.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => tracker.discard() },
    ]);

  return (
    <>
      <View style={{ flex: 1, backgroundColor: c.ground }}>
        <TopBar title="Run" />
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
          {tracker.resumable ? (
            <Label style={{ marginTop: 12, paddingHorizontal: 18, paddingVertical: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.live }} />
                <BlancText variant="headline">Run in progress</BlancText>
              </View>
              <BlancText variant="secondary" tone="graphite" style={{ marginTop: 4 }}>
                It was interrupted. Pick it back up, or discard it to start another.
              </BlancText>
              <Capsule title="Discard" variant="quiet" onPress={discardInterrupted} style={{ marginTop: 14 }} />
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
              <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: 4, marginTop: 10 }}>
                {mode === 'intervals' ? 'Split on demand or by distance.' : 'Live and average pace.'}
              </BlancText>
            </View>
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
                Location is off for hyPer. Allow it, with Precise Location, to track runs.
              </BlancText>
              <Capsule title="Open Settings" variant="quiet" onPress={() => void Linking.openSettings()} />
            </View>
          ) : tracker.gpsError ? (
            <FormNote alert>{tracker.gpsError}</FormNote>
          ) : null}
        </ScrollView>

        <View style={{ paddingHorizontal: space.inset, paddingTop: 8, paddingBottom: insets.bottom + 12 }}>
          {tracker.resumable ? (
            <Capsule title="Resume run" size="large" fill onPress={() => tracker.resume()} />
          ) : (
            <Capsule title="Start run" size="large" fill busy={starting} disabled={!valid} onPress={() => void start()} />
          )}
        </View>
      </View>
    </>
  );
}

/** A label and iOS's pull-down menu of choices, like a Settings row. */
function MenuRow({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const c = useBlanc();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingLeft: 18, paddingRight: 8 }}>
      <BlancText variant="body" style={{ flex: 1 }}>
        {label}
      </BlancText>
      <Host matchContents>
        <Picker
          selection={value}
          onSelectionChange={(next) => {
            if (next === value) return;
            haptics.select();
            onChange(String(next));
          }}
          modifiers={[pickerStyle('menu'), tint(c.graphite)]}>
          {options.map((option) => (
            <SwiftText key={option.value} modifiers={[tag(option.value)]}>
              {option.label}
            </SwiftText>
          ))}
        </Picker>
      </Host>
    </View>
  );
}

/* ── During the run ── */

function Live({ tracker, state }: { tracker: Tracker; state: TrackerState }) {
  const c = useBlanc();
  const insets = useSafeAreaInsets();
  const now = tracker.nowMs;
  const intervals = state.config.mode === 'intervals';
  const status = runStatus(state, now);
  const alert = status !== 'ok';
  // A rest lap has no pace; its clock is the figure worth reading.
  const restHero = tracker.resting && intervals;
  const pace = formatRunPace(livePaceSecPerMile(state, now)) ?? '—';
  const [figure, unit] = restHero ? [formatRunClock(currentLapSeconds(state, now)), ''] : splitFigure(pace);
  const lastLap = state.laps.length > 0 ? state.laps[state.laps.length - 1] : null;

  return (
    <>
      <View style={{ flex: 1, backgroundColor: c.ground, paddingTop: insets.top + 10, paddingBottom: insets.bottom + 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, paddingHorizontal: space.gutter }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {!tracker.resting ? <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: c.live }} /> : null}
            <BlancText variant="headline">{RUN_MODE_LABELS[state.config.mode]}</BlancText>
          </View>
          <BlancText variant="secondary" tone={alert ? 'live' : 'graphite'} accessibilityLiveRegion="polite">
            {RUN_STATUS_LABELS[status]}
          </BlancText>
        </View>
        {tracker.gpsError ? (
          <BlancText variant="footnote" tone="live" accessibilityRole="alert" style={{ marginHorizontal: space.gutter, marginTop: 4 }}>
            {tracker.gpsError}
          </BlancText>
        ) : null}

        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: space.gutter }}>
          <BlancText variant="secondary" tone="graphite">
            {restHero ? 'Rest' : tracker.resting ? 'Paused' : intervals ? 'Lap pace' : 'Pace'}
          </BlancText>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 2 }} accessible accessibilityLabel={`${restHero ? 'Rest' : 'Pace'} ${figure} ${unit === '/mi' ? 'per mile' : ''}`}>
            <BlancText variant="figure" size={104} style={{ letterSpacing: -3, lineHeight: 116 }} numberOfLines={1} adjustsFontSizeToFit>
              {figure}
            </BlancText>
            {unit ? (
              <BlancText variant="body" tone="graphite">
                {unit}
              </BlancText>
            ) : null}
          </View>

          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.hairline, marginTop: 28 }} />
          <View style={{ flexDirection: 'row', marginTop: 16 }}>
            <Stat label="Time" value={formatRunClock(elapsedSeconds(state, now))} />
            <Stat label="Distance" value={formatRunDistance(state.totalDistanceM)} />
            <Stat label="Avg pace" value={formatRunPace(averagePaceSecPerMile(state, now)) ?? '—'} />
          </View>

          {intervals ? (
            <>
              <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.hairline, marginTop: 20 }} />
              <View style={{ flexDirection: 'row', marginTop: 16 }}>
                <Detail
                  label={tracker.resting ? 'Resting' : `Lap ${state.laps.length + 1}`}
                  value={`${formatRunClock(currentLapSeconds(state, now))} · ${formatRunDistance(currentLapDistanceM(state))}`}
                />
                <Detail
                  label="Last split"
                  value={lastLap ? `${formatRunClock((lastLap.endedAtMs - lastLap.startedAtMs) / 1000)} · ${formatRunDistance(lastLap.distanceM)}` : '—'}
                />
              </View>
            </>
          ) : null}

          {state.config.mode === 'sprints' ? (
            <>
              <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.hairline, marginTop: 20 }} />
              <View style={{ flexDirection: 'row', marginTop: 16 }}>
                <Detail label="Sprints" value={`${state.reps.length}${state.sprintPhase === 'active' ? ' ●' : ''}`} />
                <Detail
                  label="Last rep"
                  value={
                    state.reps.length > 0
                      ? `${formatRunDistance(state.reps[state.reps.length - 1].distanceM)} · ${state.reps[state.reps.length - 1].peakSpeedMps.toFixed(1)} m/s peak`
                      : '—'
                  }
                />
              </View>
            </>
          ) : null}
        </View>

        {/* Big controls for running hands; finishing needs a hold. */}
        <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: space.inset }}>
          {intervals && !tracker.resting ? (
            <BigButton
              title="Split"
              primary
              onPress={() => {
                haptics.tap();
                tracker.split();
              }}
            />
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

function Stat({ label, value }: { label: string; value: string }) {
  const [number, unit] = splitFigure(value);
  return (
    <View style={{ flex: 1, minWidth: 0 }} accessible accessibilityLabel={`${label} ${value}`}>
      <BlancText variant="footnote" tone="graphite">
        {label}
      </BlancText>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3, marginTop: 2 }}>
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

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, minWidth: 0 }} accessible accessibilityLabel={`${label} ${value}`}>
      <BlancText variant="footnote" tone="graphite">
        {label}
      </BlancText>
      <BlancText variant="bodyStrong" numberOfLines={1} style={{ marginTop: 3, fontVariant: ['tabular-nums'] }}>
        {value}
      </BlancText>
    </View>
  );
}

function BigButton({ title, primary, onPress }: { title: string; primary?: boolean; onPress: () => void }) {
  const c = useBlanc();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        height: 64,
        borderRadius: 32,
        borderCurve: 'continuous',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: primary ? c.capsule : c.fill,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}>
      <BlancText variant="headline" tone={primary ? 'onCapsule' : 'ink'} size={18}>
        {title}
      </BlancText>
    </Pressable>
  );
}

const HOLD_TO_FINISH_MS = 800;

/** Finishing ends the run, so it takes a deliberate hold, never a stray tap. */
function HoldToFinish({ onFinish }: { onFinish: () => void }) {
  const c = useBlanc();
  const [holding, setHolding] = useState(false);
  const progress = useSharedValue(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
    progress.value = withTiming(0, { duration: 150 });
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const begin = () => {
    haptics.tap();
    setHolding(true);
    progress.value = withTiming(1, { duration: HOLD_TO_FINISH_MS, easing: Easing.linear });
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      haptics.success();
      onFinish();
    }, HOLD_TO_FINISH_MS);
  };

  const fill = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Finish run"
      accessibilityHint="Hold to finish"
      accessibilityActions={[{ name: 'activate', label: 'Finish run' }]}
      onAccessibilityAction={() =>
        Alert.alert('Finish this run?', undefined, [
          { text: 'Keep running', style: 'cancel' },
          { text: 'Finish', onPress: onFinish },
        ])
      }
      onPressIn={begin}
      onPressOut={cancel}
      style={{ flex: 1.3, height: 64, borderRadius: 32, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: c.fill, justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: c.ink, opacity: 0.16 }, fill]} />
      <BlancText variant="headline" size={18} style={{ textAlign: 'center' }}>
        {holding ? 'Keep holding…' : 'Hold to finish'}
      </BlancText>
    </Pressable>
  );
}

/* ── After the run ── */

function Finished({ run, discard }: { run: FinishedRun; discard: () => void }) {
  const c = useBlanc();
  const insets = useSafeAreaInsets();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [exportError, setExportError] = useState(false);
  const splits = finishedRunSplits(run);
  const [distance, distanceUnit] = splitFigure(formatRunDistance(run.totalDistanceM));
  const workSplits = splits.filter((split) => !split.isRest).length;

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
      discard();
      router.dismiss();
      router.navigate('/train/history');
    } catch (error) {
      haptics.error();
      setSaveError(runSaveErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const confirmDiscard = () =>
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

  const exportDiagnostics = () => {
    setExportError(false);
    const { filename, content } = gpsDiagnosticsExport(run, new Date());
    void NativeRun.shareDiagnostics({ filename, content }).catch(() => setExportError(true));
  };

  return (
    <>
      <View style={{ flex: 1, backgroundColor: c.ground }}>
        <TopBar />
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
          <View style={{ paddingHorizontal: space.gutter, paddingTop: 8 }}>
            <BlancText variant="secondary" tone="graphite">
              {RUN_MODE_LABELS[run.mode]} · {format(run.startedAtMs, 'EEE, MMM d · h:mm a')}
            </BlancText>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 6 }}>
              <BlancText variant="figure" size={88} style={{ letterSpacing: -2.5, lineHeight: 98 }}>
                {distance}
              </BlancText>
              <BlancText variant="body" tone="graphite">
                {distanceUnit}
              </BlancText>
            </View>
            <View style={{ flexDirection: 'row', marginTop: 18 }}>
              <Stat label="Time" value={formatRunClock(run.elapsedS)} />
              <Stat label="Avg pace" value={finishedRunPace(run) ?? '—'} />
            </View>
          </View>

          {splits.length > 1 ? (
            <Section title="Splits" note={String(workSplits)}>
              <Label style={{ paddingHorizontal: 18, paddingVertical: 10 }}>
                {splits.map((split, index) => {
                  const pace = split.isRest ? null : formatRunPace(splitPaceSecPerMile(split));
                  return (
                    <View
                      key={`${split.key}-${index}`}
                      accessible
                      accessibilityLabel={
                        split.isRest
                          ? `Rest, ${formatRunClock(split.durationS)}`
                          : `Split ${split.key}, ${formatRunClock(split.durationS)}, ${formatRunDistance(split.distanceM)}${pace ? `, ${pace}` : ''}`
                      }
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 }}>
                      <BlancText variant="meta" size={13} tone="graphite" style={{ width: 22 }}>
                        {split.isRest ? '·' : split.key}
                      </BlancText>
                      <BlancText variant="meta" size={14} tone={split.isRest ? 'graphite' : 'ink'} style={{ flex: 1 }}>
                        {formatRunClock(split.durationS)}
                      </BlancText>
                      <BlancText variant="meta" size={14} tone={split.isRest ? 'graphite' : 'ink'} style={{ flex: 1, textAlign: 'right' }}>
                        {split.isRest ? 'rest' : formatRunDistance(split.distanceM)}
                      </BlancText>
                      <BlancText variant="meta" size={14} tone={split.isRest ? 'graphite' : 'ink'} style={{ width: 96, textAlign: 'right' }}>
                        {split.isRest ? '' : (pace ?? '—')}
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
              <Row title="Discard run" destructive onPress={confirmDiscard} />
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
