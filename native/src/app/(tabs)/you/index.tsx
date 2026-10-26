import { Stack } from 'expo-router';
import { View } from 'react-native';

import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { BlancText } from '~/components/BlancText';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { TabScroll } from '~/components/TabScroll';
import { isPreviewActive } from '~/platform/previewFlag';
import { formatWhole } from '~/lib/format';
import { space, useBlanc } from '~/theme/blanc';

export default function YouScreen() {
  const c = useBlanc();
  const user = useAuthStore((state) => state.user);
  const profile = useAuthStore((state) => state.profile);
  const target = useAppStore((state) => state.macroTarget);
  const split = useAppStore((state) => state.activeSplit);
  const name =
    profile?.display_name ?? (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? 'You';
  const initials = name
    .split(' ')
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <>
      <Stack.Screen options={{ title: 'You' }} />
      <TabScroll>
        <Label style={{ marginTop: 8 }}>
          <Row
            title={name}
            detail={user?.email ?? undefined}
            leading={
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: c.fill,
                }}>
                <BlancText variant="secondary" weight="600">
                  {initials}
                </BlancText>
              </View>
            }
          />
        </Label>

        {target ? (
          <Section title="Nutrition">
            <Label>
              <Row title="Calories" value={`${formatWhole(target.calories)} kcal`} />
              <Hairline />
              <Row title="Protein" value={`${formatWhole(target.protein)} g`} />
              <Hairline />
              <Row title="Carbs" value={`${formatWhole(target.carbs)} g`} />
              <Hairline />
              <Row title="Fat" value={`${formatWhole(target.fat)} g`} />
            </Label>
          </Section>
        ) : null}

        {split ? (
          <Section title="Training">
            <Label>
              <Row title="Program" value={split.name} />
              <Hairline />
              <Row title="Days per week" value={String(split.days_per_week)} />
            </Label>
          </Section>
        ) : null}

        {isPreviewActive() ? (
          <BlancText variant="footnote" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 24 }}>
            Preview with sample data. Nothing here touches your account. Sign-in, editing and the rest of You come in the next steps.
          </BlancText>
        ) : null}
      </TabScroll>
    </>
  );
}
