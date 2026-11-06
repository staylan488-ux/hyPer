import { HStack, Host, Image, Menu, Text as SwiftText, Toggle } from '@expo/ui/swift-ui';
import { accessibilityHidden, accessibilityLabel, accessibilityValue, font, foregroundStyle } from '@expo/ui/swift-ui/modifiers';
import { format } from 'date-fns';
import { router, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, useWindowDimensions, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useAdaptiveSplitScheduling } from '@/hooks/useAdaptiveSplitScheduling';
import { saveAdaptiveSplitScheduling } from '@/lib/adaptiveSplitScheduling';
import { bodyWeightTrends } from '@/lib/bodyWeightSummary';
import { formatWeight } from '@/lib/weightDisplayCore';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { BlancText } from '~/components/BlancText';
import { FormNote, ToggleRow } from '~/components/Form';
import { FuelReminderSetting } from '~/components/FuelReminderSetting';
import { Label } from '~/components/Label';
import { RollingText } from '~/components/RollingText';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { TabScroll } from '~/components/TabScroll';
import { WeightChart } from '~/components/WeightChart';
import { speak, useLargeText } from '~/lib/accessibility';
import { useCurrentDayKey } from '~/lib/accountData';
import { formatWhole } from '~/lib/format';
import { dayKey } from '~/lib/fuel';
import { haptics } from '~/lib/haptics';
import { figureLayout, rowLayout } from '~/lib/motion';
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
  type AppearanceChoice,
} from '~/lib/you';
import { centredTrendLine } from '~/lib/weightTrendLine';
import { summaryRateLabel } from '~/lib/weightRate';
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
  // Before the account's targets load, no "Not set": as on Today and Fuel.
  const userId = user?.id;
  const targetKnown = useAppStore((state) => Boolean(userId) && state.macroTargetLoadedForUserId === userId);
  const whoop = useAppStore((state) => state.whoopConnection);
  const health = useHealthStore((state) => state.enabled);
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
  // Nothing connected shows no value: a placeholder "None" says nothing the row doesn't.
  const connections = connected || undefined;

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

        <Label layout={rowLayout} style={{ marginTop: space.section }}>
          <Row
            title="Targets"
            value={targetsFailed ? 'Not loaded' : target ? `${formatWhole(target.calories)} kcal` : targetKnown ? 'Not set' : undefined}
            chevron
            onPress={() => router.push('/you/targets')}
          />
          <Hairline />
          <Row
            title="Saved meals"
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

        <FuelReminderSetting />

        {/* Food, then training, then the app itself. */}
        <SchedulingSetting />

        <Label layout={rowLayout} style={{ marginTop: space.section }}>
          <Row title="Connections" value={connections} chevron onPress={() => router.push('/you/connections')} />
          <Hairline />
          <AppearanceRow />
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
      {/* The circle doesn't grow, so the initials stop where they still fit. */}
      <BlancText variant="secondary" weight="600" maxFontSizeMultiplier={1.3}>
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
  const large = useLargeText();
  const { trend, rate } = useMemo(() => bodyWeightTrends(history), [history]);
  const latest = history[0] ?? null;
  // One decimal, as Body weight's chart line rounds it.
  const rateLabel = summaryRateLabel(rate.kgPerWeek, unit);
  const latestDate = latest ? new Date(latest.measured_at) : null;
  const todayKey = useCurrentDayKey();
  const line = rateLabel
    ? `${rateLabel} over 3 weeks`
    : latestDate
      ? dayKey(latestDate) === todayKey
        ? 'Today'
        : format(latestDate, 'MMM d')
      : null;

  return (
    <Section title="Body weight" action={{ title: 'Log', symbol: 'plus', onPress: () => router.push('/log-weight') }}>
      <Label layout={rowLayout} style={{ overflow: 'hidden' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            latest
              ? speak(`Body weight ${formatWeight(Number(latest.kilograms), unit)} ${unit}${line ? `, ${line.replace('/wk', ' a week')}` : ''}`)
              : loading
                ? 'Body weight'
                : failed
                  ? 'Body weight, not loaded. Open to try again.'
                  : 'Body weight, no weigh-ins yet. Log one to start your trend.'
          }
          onPress={() => {
            haptics.tap();
            router.push('/you/weight');
          }}
          style={({ pressed }) => ({ padding: 18, gap: 4, backgroundColor: pressed ? c.pressed : 'transparent' })}>
          {latest ? (
            <>
              {/* The chevron says the card opens every weigh-in, as an iOS row's does. */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                {/* At the accessibility text sizes the unit may wrap below the capped figure. */}
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 6, ...(large ? { flexWrap: 'wrap', rowGap: 0 } : null) }}>
                  <RollingText variant="figure" size={44}>
                    {formatWeight(Number(latest.kilograms), unit)}
                  </RollingText>
                  <Animated.View layout={figureLayout}>
                    <BlancText variant="secondary" tone="graphite">
                      {unit}
                    </BlancText>
                  </Animated.View>
                </View>
                <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={c.upcoming} style={{ marginRight: -2 }} />
              </View>
              {line ? (
                <BlancText variant="secondary" tone="graphite">
                  {line}
                </BlancText>
              ) : null}
              {trend.fittedDayCount >= 2 ? (
                <View style={{ marginTop: 10 }} pointerEvents="none">
                  <WeightChart points={centredTrendLine(trend.points)} days={21} unit={unit} height={44} compact />
                </View>
              ) : null}
            </>
          ) : (
            <>
              {loading ? null : (
                <View style={{ position: 'absolute', top: 0, bottom: 0, right: 16, justifyContent: 'center' }}>
                  <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={c.upcoming} />
                </View>
              )}
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
  const large = useLargeText();
  const { fontScale } = useWindowDimensions();
  const choice = useAppearanceStore((state) => state.choice);
  return (
    // At the accessibility text sizes the menu sits under its label.
    <View
      style={
        large
          ? { alignItems: 'flex-start', minHeight: 60, paddingVertical: 10, paddingLeft: 18, paddingRight: 16, gap: 4 }
          : { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingLeft: 18, paddingRight: 16 }
      }>
      {/* The menu says its own name to VoiceOver, with the choice as its value: one stop, "Appearance, Automatic". */}
      <BlancText variant="body" style={large ? undefined : { flex: 1 }} accessibilityElementsHidden importantForAccessibility="no">
        Appearance
      </BlancText>
      <Host matchContents>
        <Menu
          label={
            <HStack spacing={10}>
              <SwiftText modifiers={[font({ size: 15 * fontScale }), foregroundStyle(c.graphite)]}>{APPEARANCE_LABELS[choice]}</SwiftText>
              <Image systemName="chevron.up.chevron.down" color={c.upcoming} modifiers={[font({ size: 13, weight: 'semibold' }), accessibilityHidden(true)]} />
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
    <Animated.View layout={rowLayout} style={{ marginTop: space.section }}>
      <Label>
        <ToggleRow list label="Adaptive scheduling" value={enabled} disabled={saving || !userId} onChange={(next) => void toggle(next)} />
      </Label>
      <FormNote alert={failed}>
        {failed
          ? 'Couldn’t save this setting. Your previous choice is still active.'
          : 'Upcoming workouts and rest days follow the program days you complete. Off keeps your saved schedule.'}
      </FormNote>
    </Animated.View>
  );
}
