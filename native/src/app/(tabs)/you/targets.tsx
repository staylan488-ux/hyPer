import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { getPhotoWorkerSettings } from '@/lib/photoAnalysis';
import { baseTargets, expenditureSummary, resumeAdaptiveMessage, targetModeLabel } from '@/lib/settingsUx';
import { useAppStore } from '@/stores/appStore';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { FormNote } from '~/components/Form';
import { Label } from '~/components/Label';
import { RollingText } from '~/components/RollingText';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { TabScroll } from '~/components/TabScroll';
import { formatWhole } from '~/lib/format';
import { announce, speak, useAnnounce, useLargeText } from '~/lib/accessibility';
import { haptics } from '~/lib/haptics';
import { figureLayout } from '~/lib/motion';
import { isPreviewActive } from '~/platform/previewFlag';
import { loadTargets, useAnalysisModeStore, usePullRefresh, useTargetsStore } from '~/lib/you';
import { space } from '~/theme/blanc';

const REFRESH_FAILED = 'Couldn’t refresh your targets. These are the last ones loaded.';

/**
 * Nutrition targets: the daily calories and macros, how they are kept (by
 * hand or adapting), and the two ways to get new ones.
 */
export default function TargetsScreen() {
  const target = useAppStore((state) => state.macroTarget);
  const profile = useAppStore((state) => state.nutritionProfile);
  const status = useTargetsStore((state) => state.status);
  const message = useTargetsStore((state) => state.message);
  // A save's result (here or from the edit sheet over this screen), not one
  // left from an earlier visit; errors announce themselves (FormNote).
  const [earlier] = useState(message);
  // Keyed on the object, not its text: a second save with the same words is
  // a new message and is announced again.
  useEffect(() => {
    if (message && message !== earlier && !message.alert) announce(message.text);
  }, [message, earlier]);
  const large = useLargeText();
  const [resuming, setResuming] = useState(false);
  const base = baseTargets(target);
  const ready = status === 'ready' || target !== null;
  // A refresh that failed keeps the last targets and says so under them.
  const refreshFailed = status === 'error' && target !== null;
  useAnnounce(refreshFailed ? REFRESH_FAILED : null);
  const mode = targetModeLabel(target ? base.source : undefined, profile?.adaptive_enabled);
  const burn = expenditureSummary(profile);
  // The coach is the AI chosen in Food analysis: Gemini needs nothing set
  // up, the Mac worker needs its address.
  const analysis = useAnalysisModeStore((state) => state.mode);
  const coachAvailable = analysis === 'gemini' || isPreviewActive() || Boolean(getPhotoWorkerSettings().url);
  const { refreshing, refresh } = usePullRefresh(loadTargets);
  // A number opens the edit sheet with its own field ready to type.
  const edit = (focus: 'calories' | 'protein' | 'carbs' | 'fat') => router.push({ pathname: '/targets-edit', params: { focus } });

  useEffect(() => {
    void loadTargets();
    useTargetsStore.setState({ message: null });
  }, []);

  const resume = async () => {
    if (resuming) return;
    setResuming(true);
    useTargetsStore.setState({ message: null });
    try {
      const store = useAppStore.getState();
      // Hand the target back to the loop, then let it recompute now rather
      // than at the next weekly window.
      await store.updateMacroTarget({ ...base, source: 'calculated' });
      const refresh = await useAppStore.getState().refreshAdaptiveTargets({ force: true });
      haptics.success();
      useTargetsStore.setState({ message: { text: resumeAdaptiveMessage(profile?.adaptive_enabled, refresh) } });
    } catch {
      haptics.error();
      useTargetsStore.setState({ message: { text: 'Could not resume adaptive targets. Please try again.', alert: true } });
    } finally {
      setResuming(false);
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Targets',
          unstable_headerRightItems: () =>
            ready
              ? [
                  {
                    type: 'button',
                    label: 'Edit',
                    onPress: () => {
                      haptics.tap();
                      router.push('/targets-edit');
                    },
                  },
                ]
              : [],
        }}
      />
      <TabScroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
        {status === 'error' && !target ? (
          <Label style={{ marginTop: 12, padding: 18, gap: 14 }}>
            <View style={{ gap: 2 }}>
              <BlancText variant="headline">Targets not loaded</BlancText>
              <BlancText variant="secondary" tone="graphite">
                Check your connection and try again.
              </BlancText>
            </View>
            <Capsule title="Try again" fill onPress={() => void loadTargets()} />
          </Label>
        ) : (
          <>
            <View style={{ paddingHorizontal: space.gutter, paddingTop: 12 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={ready ? speak(`${formatWhole(base.calories)} kcal a day, ${target ? mode : 'starting defaults, not saved'}`) : 'Calories'}
                accessibilityHint={ready ? 'Edits your targets' : undefined}
                accessibilityState={ready ? undefined : { disabled: true }}
                disabled={!ready}
                onPress={() => {
                  haptics.tap();
                  edit('calories');
                }}
                style={({ pressed }) => ({ alignSelf: 'flex-start', opacity: pressed ? 0.45 : 1 })}>
                {/* At the accessibility text sizes the words wrap below the capped figure. */}
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, ...(large ? { flexWrap: 'wrap', rowGap: 0 } : null) }}>
                  <RollingText variant="figure" size={64}>
                    {ready ? formatWhole(base.calories) : ' '}
                  </RollingText>
                  <Animated.View layout={figureLayout}>
                    <BlancText variant="secondary" tone="graphite">
                      kcal a day
                    </BlancText>
                  </Animated.View>
                </View>
                <BlancText variant="secondary" tone="graphite">
                  {!ready ? ' ' : target ? mode : 'Starting defaults, not saved'}
                </BlancText>
              </Pressable>
              {/* A refresh that failed says so under the numbers it left in place. */}
              {refreshFailed ? (
                <BlancText variant="footnote" tone="live" style={{ marginTop: 4 }} accessibilityRole="alert">
                  {REFRESH_FAILED}
                </BlancText>
              ) : null}
            </View>
            <Label style={{ marginTop: 24 }}>
              <Row
                title="Protein"
                value={ready ? `${formatWhole(base.protein)} g` : undefined}
                onPress={ready ? () => edit('protein') : undefined}
              />
              <Hairline />
              <Row title="Carbs" value={ready ? `${formatWhole(base.carbs)} g` : undefined} onPress={ready ? () => edit('carbs') : undefined} />
              <Hairline />
              <Row title="Fat" value={ready ? `${formatWhole(base.fat)} g` : undefined} onPress={ready ? () => edit('fat') : undefined} />
            </Label>
          </>
        )}

        <Label style={{ marginTop: space.section }}>
          <Row title="Calculate targets" chevron onPress={() => router.push('/targets-calculate')} />
          {coachAvailable ? (
            <>
              <Hairline />
              <Row title="Suggest targets" chevron onPress={() => router.push('/targets-coach')} />
            </>
          ) : null}
        </Label>

        {profile ? (
          <Section title="Adaptive targets">
            <Label>
              <Row
                title="Daily burn"
                detail={burn.source}
                value={burn.kcal === null ? undefined : `${formatWhole(burn.kcal)} kcal`}
                chevron
                onPress={() => router.push('/you/adaptation')}
              />
            </Label>
            {base.source === 'manual' ? (
              <View style={{ marginHorizontal: space.inset, marginTop: 14 }}>
                <Capsule title="Resume adaptive targets" variant="quiet" fill busy={resuming} onPress={() => void resume()} />
              </View>
            ) : null}
          </Section>
        ) : null}

        {/* What Resume did, under the button that did it. A message left from an
            earlier visit shows until the mount effect clears it, but is not announced. */}
        {message ? (
          <FormNote alert={message.alert} announcement={message === earlier ? '' : undefined}>
            {message.text}
          </FormNote>
        ) : null}
      </TabScroll>
    </>
  );
}
