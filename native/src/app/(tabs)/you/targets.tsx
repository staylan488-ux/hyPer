import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { getPhotoWorkerSettings } from '@/lib/photoAnalysis';
import { baseTargets, expenditureSummary, resumeAdaptiveMessage, targetModeLabel } from '@/lib/settingsUx';
import { useAppStore } from '@/stores/appStore';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { FormNote } from '~/components/Form';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { TabScroll } from '~/components/TabScroll';
import { formatWhole } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import { isPreviewActive } from '~/platform/previewFlag';
import { loadTargets, useAnalysisModeStore, useTargetsStore } from '~/lib/you';
import { space } from '~/theme/blanc';

/**
 * Nutrition targets: the daily calories and macros, how they are kept (by
 * hand or adapting), and the two ways to get new ones.
 */
export default function TargetsScreen() {
  const target = useAppStore((state) => state.macroTarget);
  const profile = useAppStore((state) => state.nutritionProfile);
  const status = useTargetsStore((state) => state.status);
  const message = useTargetsStore((state) => state.message);
  const [resuming, setResuming] = useState(false);
  const base = baseTargets(target);
  const ready = status === 'ready' || target !== null;
  const mode = targetModeLabel(target ? base.source : undefined, profile?.adaptive_enabled);
  const burn = expenditureSummary(profile);
  // The coach runs only on the Mac worker, so it shows only for someone who
  // chose Your Mac in Food analysis and has a worker to ask.
  const analysis = useAnalysisModeStore((state) => state.mode);
  const coachAvailable = analysis === 'worker' && (isPreviewActive() || Boolean(getPhotoWorkerSettings().url));

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
      <TabScroll>
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
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                <BlancText variant="figure" size={64}>
                  {ready ? formatWhole(base.calories) : ' '}
                </BlancText>
                <BlancText variant="secondary" tone="graphite">
                  kcal a day
                </BlancText>
              </View>
              <BlancText variant="secondary" tone="graphite">
                {!ready ? ' ' : target ? mode : 'Starting defaults, not saved'}
              </BlancText>
            </View>
            <Label style={{ marginTop: 24 }}>
              <Row title="Protein" value={ready ? `${formatWhole(base.protein)} g` : undefined} />
              <Hairline />
              <Row title="Carbs" value={ready ? `${formatWhole(base.carbs)} g` : undefined} />
              <Hairline />
              <Row title="Fat" value={ready ? `${formatWhole(base.fat)} g` : undefined} />
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
          <Section title="Automatic adjustments">
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
              <>
                <View style={{ marginHorizontal: space.inset, marginTop: 14 }}>
                  <Capsule title="Resume adaptive targets" variant="quiet" fill busy={resuming} onPress={() => void resume()} />
                </View>
                <FormNote>Your targets are set by hand, so they stay fixed until you resume.</FormNote>
              </>
            ) : null}
          </Section>
        ) : null}

        {message ? <FormNote alert={message.alert}>{message.text}</FormNote> : null}
      </TabScroll>
    </>
  );
}
