import { router, Stack } from 'expo-router';
import { View } from 'react-native';

import { expenditureSummary } from '@/lib/settingsUx';
import { useAppStore } from '@/stores/appStore';
import { BlancText } from '~/components/BlancText';
import { Label } from '~/components/Label';
import { Row } from '~/components/Row';
import { TabScroll } from '~/components/TabScroll';
import { formatWhole } from '~/lib/format';
import { space } from '~/theme/blanc';

/** The daily burn, once one is learned, and how targets adapt, in plain words. */
export default function AdaptationScreen() {
  const profile = useAppStore((state) => state.nutritionProfile);
  const burn = expenditureSummary(profile);
  return (
    <>
      <Stack.Screen options={{ title: 'Daily burn' }} />
      <TabScroll>
        {burn.kcal !== null ? (
          <View accessible style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, paddingHorizontal: space.gutter, paddingTop: 12 }}>
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
