import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { expenditureSummary } from '@/lib/settingsUx';
import { burnProgressLine, type BurnProgress } from '@/lib/targetChanges';
import { useAppStore } from '@/stores/appStore';
import { BlancText } from '~/components/BlancText';
import { Label } from '~/components/Label';
import { Row } from '~/components/Row';
import { TabScroll } from '~/components/TabScroll';
import { useLargeText } from '~/lib/accessibility';
import { formatWhole } from '~/lib/format';
import { space } from '~/theme/blanc';

/**
 * The daily burn, once one is learned, and how targets adapt, in plain words.
 * While it is still learning, how far along it is, from the same counts the
 * weekly update makes.
 */
export default function AdaptationScreen() {
  const profile = useAppStore((state) => state.nutritionProfile);
  const burn = expenditureSummary(profile);
  const large = useLargeText();
  const learning = burn.kcal === null && Boolean(profile?.adaptive_enabled);
  const [progress, setProgress] = useState<BurnProgress | null>(null);

  // Read on opening (and when the profile changes); a failed read shows no line.
  useEffect(() => {
    if (!learning) return;
    let live = true;
    void useAppStore.getState().readBurnProgress().then((next) => {
      if (live) setProgress(next);
    });
    return () => {
      live = false;
    };
  }, [learning, profile]);
  return (
    <>
      <Stack.Screen options={{ title: 'Daily burn' }} />
      <TabScroll>
        {burn.kcal !== null ? (
          // At the accessibility text sizes the words wrap below the capped figure.
          <View
            accessible
            style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, paddingHorizontal: space.gutter, paddingTop: 12, ...(large ? { flexWrap: 'wrap', rowGap: 0 } : null) }}>
            <BlancText variant="figure" size={64}>
              {formatWhole(burn.kcal)}
            </BlancText>
            <BlancText variant="secondary" tone="graphite">
              kcal a day
            </BlancText>
          </View>
        ) : null}
        <BlancText variant="body" style={{ marginHorizontal: space.gutter, marginTop: burn.kcal !== null ? 16 : 12 }}>
          {burn.explanation}
        </BlancText>
        {learning && progress ? (
          <BlancText variant="body" style={{ marginHorizontal: space.gutter, marginTop: 14 }}>
            {burnProgressLine(progress)}
          </BlancText>
        ) : null}
        <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 14 }}>
          These are estimates, not measurements. Targets set by hand stay fixed until you resume adaptive targets.
        </BlancText>
        <Label style={{ marginTop: 28 }}>
          <Row title="Body weight" chevron onPress={() => router.push('/you/weight')} />
        </Label>
      </TabScroll>
    </>
  );
}
