import { router, Stack } from 'expo-router';

import { expenditureSummary } from '@/lib/settingsUx';
import { useAppStore } from '@/stores/appStore';
import { BlancText } from '~/components/BlancText';
import { Label } from '~/components/Label';
import { Row } from '~/components/Row';
import { TabScroll } from '~/components/TabScroll';
import { space } from '~/theme/blanc';

/** How targets adapt, in plain words. */
export default function AdaptationScreen() {
  const profile = useAppStore((state) => state.nutritionProfile);
  const burn = expenditureSummary(profile);
  return (
    <>
      <Stack.Screen options={{ title: 'How targets adapt' }} />
      <TabScroll>
        <BlancText variant="body" style={{ marginHorizontal: space.gutter, marginTop: 12 }}>
          {burn.explanation}
        </BlancText>
        <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 14 }}>
          These are estimates, not measurements. Automatic targets use your nutrition profile, food logs and weight
          trend. Targets set by hand stay fixed until you resume automatic management.
        </BlancText>
        <Label style={{ marginTop: 28 }}>
          <Row title="Body weight" chevron onPress={() => router.push('/you/weight')} />
        </Label>
      </TabScroll>
    </>
  );
}
