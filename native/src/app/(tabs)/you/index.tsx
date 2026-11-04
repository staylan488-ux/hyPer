import { HStack, Host, Image, Menu, Text as SwiftText, Toggle } from '@expo/ui/swift-ui';
import { accessibilityLabel, accessibilityValue, font, foregroundStyle } from '@expo/ui/swift-ui/modifiers';
import { format, isToday } from 'date-fns';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, useWindowDimensions, View } from 'react-native';

import { useAdaptiveSplitScheduling } from '@/hooks/useAdaptiveSplitScheduling';
import { saveAdaptiveSplitScheduling } from '@/lib/adaptiveSplitScheduling';
import { bodyWeightTrends, weeklyRateLabel } from '@/lib/bodyWeightSummary';
import { formatWeight } from '@/lib/weightDisplayCore';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { BlancText } from '~/components/BlancText';
import { FormNote, ToggleRow } from '~/components/Form';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { TabScroll } from '~/components/TabScroll';
import { WeightChart } from '~/components/WeightChart';
import { formatWhole } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import {
  APPEARANCE_LABELS,
  chooseAppearance,
  loadYou,
  useAnalysisModeStore,
  useAppearanceStore,
  useHealthStore,
  usePullRefresh,
  useTargetsStore,
  useWeightStore,
  useYouMealsStore,
  type AppearanceChoice,
} from '~/lib/you';
import { space, useBlanc } from '~/theme/blanc';

/**
 * You: who is signed in, body weight with Log, and the settings that shape
 * the rest of the app. Each row says where it stands in a word or two.
 */
export default function YouScreen() {
  const user = useAuthStore((state) => state.user);
  const profile = useAuthStore((state) => state.profile);
  const target = useAppStore((state) => state.macroTarget);
  const targetsFailed = useTargetsStore((state) => state.status === 'error') && target === null;
  const whoop = useAppStore((state) => state.whoopConnection);
  const health = useHealthStore((state) => state.enabled);
  const meals = useYouMealsStore((state) => state.meals);
  const analysis = useAnalysisModeStore((state) => state.mode);
  const { refreshing, refresh } = usePullRefresh(loadYou);

  useEffect(() => {
    void loadYou();
  }, []);

  const name = profile?.display_name || (user?.user_metadata?.full_name as string | undefined) || user?.email || 'You';
  const initials = name
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();
  // Two steps: the React Compiler can't yet compile a ternary inside `||`.
  const connected = [whoop ? 'WHOOP' : null, health ? 'Health' : null].filter(Boolean).join(', ');
  const connections = connected || 'None';

  return (
    <>
      <Stack.Screen options={{ title: 'You' }} />
      <TabScroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
        <Label style={{ marginTop: 8 }}>
          <Row
            title={name}
            detail={user?.email && user.email !== name ? user.email : undefined}
            chevron
            accessibilityLabel={`${name}, account`}
            onPress={() => router.push('/you/account')}
            leading={<Initials text={initials} />}
          />
        </Label>

        <WeightCard />

        <Label style={{ marginTop: space.section }}>
          <Row
            title="Targets"
            value={targetsFailed ? 'Not loaded' : target ? `${formatWhole(target.calories)} kcal` : 'Not set'}
            chevron
            onPress={() => router.push('/you/targets')}
          />
          <Hairline />
          <Row
            title="Saved meals"
            value={meals && meals.length > 0 ? String(meals.length) : undefined}
            chevron
            onPress={() => router.push('/you/meals')}
          />
          <Hairline />
          <Row
            title="Food analysis"
            value={analysis === 'gemini' ? 'Gemini' : 'Your Mac'}
            chevron
            onPress={() => router.push('/you/analysis')}
          />
        </Label>

        <Label style={{ marginTop: space.section }}>
          <Row title="Connections" value={connections} chevron onPress={() => router.push('/you/connections')} />
          <Hairline />
          <AppearanceRow />
        </Label>

        <SchedulingSetting />

        <Label style={{ marginTop: space.section }}>
          <Row title="Start a run" chevron onPress={() => router.push('/run')} />
          <Hairline />
          <Row title="About" chevron onPress={() => router.push('/you/about')} />
        </Label>
      </TabScroll>
    </>
  );
}

function Initials({ text }: { text: string }) {
  const c = useBlanc();
  return (
    <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: c.fill }}>
      <BlancText variant="secondary" weight="600">
        {text}
      </BlancText>
    </View>
  );
}

/** The latest weigh-in, its three-week rate and a 30-day line; Log adds one. */
function WeightCard() {
  const c = useBlanc();
  const history = useWeightStore((state) => state.history);
  const loading = useWeightStore((state) => state.loading);
  const failed = useWeightStore((state) => state.failed);
  const unit = useWeightStore((state) => state.unit);
  const { trend, rate } = useMemo(() => bodyWeightTrends(history), [history]);
  const latest = history[0] ?? null;
  const rateLabel = weeklyRateLabel(rate.kgPerWeek, unit);
  const latestDate = latest ? new Date(latest.measured_at) : null;
  const line = rateLabel
    ? `${rateLabel} over 3 weeks`
    : latestDate
      ? isToday(latestDate)
        ? 'Today'
        : format(latestDate, 'MMM d')
      : null;

  return (
    <Section title="Body weight" action={{ title: 'Log', onPress: () => router.push('/log-weight') }}>
      <Label style={{ overflow: 'hidden' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            latest ? `Body weight ${formatWeight(Number(latest.kilograms), unit)} ${unit}${line ? `, ${line}` : ''}` : 'Body weight'
          }
          onPress={() => {
            haptics.tap();
            router.push('/you/weight');
          }}
          style={({ pressed }) => ({ padding: 18, gap: 4, backgroundColor: pressed ? c.pressed : 'transparent' })}>
          {latest ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                <BlancText variant="figure" size={44}>
                  {formatWeight(Number(latest.kilograms), unit)}
                </BlancText>
                <BlancText variant="secondary" tone="graphite">
                  {unit}
                </BlancText>
              </View>
              {line ? (
                <BlancText variant="secondary" tone="graphite">
                  {line}
                </BlancText>
              ) : null}
              {trend.fittedDayCount >= 2 ? (
                // The line runs to the card's edges, part of the tile rather than a chart inside it.
                <View style={{ marginTop: 10, marginHorizontal: -18 }} pointerEvents="none">
                  <WeightChart points={trend.points} days={30} unit={unit} height={44} compact />
                </View>
              ) : null}
            </>
          ) : (
            <>
              <BlancText variant="headline">{loading ? ' ' : failed ? 'Weight not loaded' : 'No weigh-ins yet'}</BlancText>
              <BlancText variant="secondary" tone="graphite">
                {loading ? ' ' : failed ? 'Open to try again.' : 'Log one to start your trend.'}
              </BlancText>
            </>
          )}
        </Pressable>
      </Label>
    </Section>
  );
}

const APPEARANCE_CHOICES: AppearanceChoice[] = ['system', 'light', 'dark'];

/**
 * Automatic, Light or Dark, in iOS's own menu. A menu picker draws its value
 * at body size, so the menu has its own label: the value as the other rows'
 * values and the ⌃⌄ on their chevrons' column.
 */
function AppearanceRow() {
  const c = useBlanc();
  const { fontScale } = useWindowDimensions();
  const choice = useAppearanceStore((state) => state.choice);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingLeft: 18, paddingRight: 16 }}>
      {/* The menu says its own name to VoiceOver, with the choice as its value. */}
      <BlancText variant="bodyStrong" accessible={false} style={{ flex: 1 }}>
        Appearance
      </BlancText>
      <Host matchContents>
        <Menu
          label={
            <HStack spacing={10}>
              <SwiftText modifiers={[font({ size: 15 * fontScale }), foregroundStyle(c.graphite)]}>{APPEARANCE_LABELS[choice]}</SwiftText>
              <Image systemName="chevron.up.chevron.down" color={c.upcoming} modifiers={[font({ size: 13, weight: 'semibold' })]} />
            </HStack>
          }
          modifiers={[accessibilityLabel('Appearance'), accessibilityValue(APPEARANCE_LABELS[choice])]}>
          {/* Checked items whose state comes from the store, as iOS draws a menu picker's. */}
          {APPEARANCE_CHOICES.map((option) => (
            <Toggle
              key={option}
              label={APPEARANCE_LABELS[option]}
              isOn={option === choice}
              onIsOnChange={(on) => {
                if (!on || option === choice) return;
                haptics.select();
                chooseAppearance(option);
              }}
            />
          ))}
        </Menu>
      </Host>
    </View>
  );
}

/** Adaptive scheduling: a switch saved to the account, with the reason under it. */
function SchedulingSetting() {
  const enabled = useAdaptiveSplitScheduling();
  const userId = useAuthStore((state) => state.user?.id);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const toggle = async (next: boolean) => {
    if (saving || !userId) return;
    setSaving(true);
    setFailed(false);
    try {
      await saveAdaptiveSplitScheduling(next);
      haptics.success();
    } catch {
      haptics.error();
      setFailed(true);
    }
    // After the try, not in a finally, which the React Compiler can't
    // compile; nothing in the catch throws.
    setSaving(false);
  };

  return (
    <View style={{ marginTop: space.section }}>
      <Label>
        <ToggleRow list label="Adaptive scheduling" value={enabled} disabled={saving || !userId} onChange={(next) => void toggle(next)} />
      </Label>
      <FormNote alert={failed}>
        {failed
          ? 'Couldn’t save this setting. Your previous choice is still active.'
          : 'Upcoming workouts and rest days follow the program days you complete. Off keeps your saved schedule.'}
      </FormNote>
    </View>
  );
}
