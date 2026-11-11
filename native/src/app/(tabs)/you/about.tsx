import { Stack } from 'expo-router';
import { Linking, View } from 'react-native';

import { BlancText } from '~/components/BlancText';
import { BrandMark, EMBLEM_MARK_SIZE } from '~/components/BrandMark';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { TabScroll } from '~/components/TabScroll';
import { appVersion } from '~/lib/appConfig';
import { openPage, PRIVACY_URL, SUPPORT_URL, TERMS_URL } from '~/lib/links';
import { space } from '~/theme/blanc';

/**
 * About: the mark, the privacy policy, terms and support (Apple asks for the
 * policy inside the app too), the version, and credit for the food data, as
 * Open Food Facts, USDA and FatSecret ask.
 */
export default function AboutScreen() {
  const version = appVersion();
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
          <Row title="Privacy policy" chevron onPress={() => void openPage(PRIVACY_URL)} />
          <Hairline />
          <Row title="Terms of use" chevron onPress={() => void openPage(TERMS_URL)} />
          <Hairline />
          <Row title="Support" chevron onPress={() => void openPage(SUPPORT_URL)} />
          <Hairline />
          {/* Tapping the version plays the row's tap, a quick check that haptics work. */}
          <Row
            title="Version"
            value={version}
            accessibilityLabel={`Version ${version}. Tap to feel a haptic.`}
            onPress={() => undefined}
          />
        </Label>

        <Section title="Food data">
          <View style={{ paddingHorizontal: space.gutter, gap: 8 }}>
            <BlancText variant="footnote" tone="graphite">
              Product data from <Link url="https://world.openfoodfacts.org/">Open Food Facts</Link>, under the{' '}
              <Link url="https://opendatacommons.org/licenses/odbl/1-0/">Open Database License</Link>.
            </BlancText>
            <BlancText variant="footnote" tone="graphite">
              Nutrient data from the U.S. Department of Agriculture, Agricultural Research Service,{' '}
              <Link url="https://fdc.nal.usda.gov/">FoodData Central</Link>.
            </BlancText>
            <BlancText variant="footnote" tone="graphite">
              Barcode and branded food data <Link url="https://www.fatsecret.com">Powered by fatsecret</Link>, where available.
            </BlancText>
            <BlancText variant="footnote" tone="graphite">
              AI food estimates by Google Gemini, with product research by Tavily. AI results are estimates: check them before you log.
            </BlancText>
          </View>
        </Section>
      </TabScroll>
    </>
  );
}

/** A credit's link, in the line's own words, as Scan's Open Food Facts credit is. */
function Link({ url, children }: { url: string; children: string }) {
  return (
    <BlancText variant="footnote" accessibilityRole="link" style={{ textDecorationLine: 'underline' }} onPress={() => void Linking.openURL(url)}>
      {children}
    </BlancText>
  );
}
