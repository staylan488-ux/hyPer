import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import { View } from 'react-native';

import { BlancText } from '~/components/BlancText';
import { BrandMark, EMBLEM_MARK_SIZE } from '~/components/BrandMark';
import { Label } from '~/components/Label';
import { Row } from '~/components/Row';
import { TabScroll } from '~/components/TabScroll';
import { space } from '~/theme/blanc';

/** About: the mark, what the app is built on, and its version. */
export default function AboutScreen() {
  const version = Constants.expoConfig?.version ?? '';
  return (
    <>
      <Stack.Screen options={{ title: 'About' }} />
      <TabScroll>
        {/* The side inset keeps the tagline off the screen's edges once it wraps (large text). */}
        <View style={{ alignItems: 'center', marginTop: 28, gap: 12, paddingHorizontal: space.gutter }}>
          <BrandMark size={EMBLEM_MARK_SIZE} />
          <BlancText variant="secondary" tone="graphite" style={{ textAlign: 'center' }}>
            Built on peer-reviewed research
          </BlancText>
        </View>
        <Label style={{ marginTop: 32 }}>
          {/* Tapping the version plays the row's tap, a quick check that haptics work. */}
          <Row
            title="Version"
            value={version}
            accessibilityLabel={`Version ${version}. Tap to feel a haptic.`}
            onPress={() => undefined}
          />
        </Label>
      </TabScroll>
    </>
  );
}
