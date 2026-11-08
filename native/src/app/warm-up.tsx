import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { BAR_CHOICES_LB, describePlates, isBarbellMovement, loadPlates, warmupSteps, type WarmupStep } from '@/lib/warmupPlates';
import { BlancText } from '~/components/BlancText';
import { FormNote, MenuRow } from '~/components/Form';
import { GlassButton } from '~/components/GlassButton';
import { Label } from '~/components/Label';
import { PlateBar, spokenPlates } from '~/components/PlateBar';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { useLargeText } from '~/lib/accessibility';
import { formatLoad } from '~/lib/format';
import { useSessionModel } from '~/lib/session';
import { parseNumber } from '~/lib/setEntry';
import { setBarWeight, tickKey, toggleWarmup, useBarWeight, useWarmupStore } from '~/lib/warmup';
import { space, useBlanc } from '~/theme/blanc';

/** "Bar × 10", "135 × 3": a warm-up set as it reads on its row. */
const stepTitle = (step: WarmupStep) => `${step.bar ? 'Bar' : formatLoad(step.weight)} × ${step.reps}`;

/**
 * Warm-up sets and plates for the movement up now, opened from the set card
 * with the weight typed there. Before a movement's first set it lists the
 * warm-ups to tick off (never logged); on a barbell it draws the plates for
 * the working weight and keeps the bar picked for the movement.
 */
export default function WarmUpSheet() {
  const c = useBlanc();
  const large = useLargeText();
  const { id, weight: weightParam } = useLocalSearchParams<{ id: string; weight?: string }>();
  const session = useSessionModel();
  const live = session?.movements.find((entry) => entry.exerciseId === id) ?? null;
  // The movement stays on screen while the sheet slides away after it changes.
  const [kept, setKept] = useState(live);
  if (live && live !== kept) setKept(live);
  const movement = live ?? kept;
  const exercise = movement?.sets.find((set) => set.exercise)?.exercise ?? null;
  const barbell = isBarbellMovement(exercise);
  const bar = useBarWeight(id ?? null, exercise);
  const working = parseNumber(weightParam ?? '');
  const ticked = useWarmupStore((state) => state.ticked);

  // Warm-ups come before the movement's first set; once one is logged the sheet is the plates alone.
  const steps = movement && movement.done === 0 && working !== null ? warmupSteps({ working, barbell, bar }) : [];
  const load = barbell && working !== null ? loadPlates(working, bar) : null;
  const title = steps.length > 0 ? 'Warm-up' : 'Plates';

  const stepRow = (step: WarmupStep, index: number) => {
    const key = session && id ? tickKey(session.workoutId, id, step) : `${index}`;
    const done = Boolean(ticked[key]);
    const plates = barbell ? loadPlates(step.weight, bar) : null;
    const detail = step.bar ? 'Empty bar' : plates && plates.perSide.length > 0 ? `${describePlates(plates.perSide)} each side` : undefined;
    const spokenWeight = step.bar ? `The bar, ${formatLoad(step.weight)} pounds` : `${formatLoad(step.weight)} pounds`;
    return (
      <View key={key}>
        {index > 0 ? <Hairline /> : null}
        <Row
          title={stepTitle(step)}
          detail={detail}
          quiet={done}
          leading={<SymbolView name={done ? 'checkmark.circle.fill' : 'circle'} size={22} weight="regular" tintColor={done ? c.ink : c.upcoming} />}
          accessibilityLabel={[`${spokenWeight} for ${step.reps} reps`, detail && !step.bar ? detail : null, done ? 'done' : null]
            .filter(Boolean)
            .join(', ')}
          onPress={() => toggleWarmup(key)}
        />
      </View>
    );
  };

  const content = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16 }}>
        <GlassButton symbol="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <BlancText variant="headline" accessibilityRole="header">
            {title}
          </BlancText>
          {movement ? (
            <BlancText variant="footnote" tone="graphite" numberOfLines={large ? undefined : 1}>
              {movement.name}
            </BlancText>
          ) : null}
        </View>
        <View style={{ width: 44 }} />
      </View>

      {steps.length > 0 ? (
        <Section title="Warm-up sets" style={{ marginTop: 18 }}>
          <Label>{steps.map(stepRow)}</Label>
          <FormNote>Tick them off as you go. They aren’t logged, so they stay out of your volume and last time.</FormNote>
        </Section>
      ) : null}

      {barbell && working !== null ? (
        <Section title={steps.length > 0 ? 'Working set' : `${formatLoad(working)} lb`} note={steps.length > 0 ? `${formatLoad(working)} lb` : undefined} style={{ marginTop: steps.length > 0 ? space.section : 18 }}>
          <Label>
            <View style={{ paddingHorizontal: 18, paddingTop: 18, paddingBottom: 14, gap: 12 }}>
              <PlateBar
                perSide={load?.perSide ?? []}
                accessibilityLabel={load ? spokenPlates(load.perSide, bar) : `Lighter than the ${formatLoad(bar)} pound bar`}
              />
              <View style={{ alignItems: 'center', gap: 2 }}>
                <BlancText variant="body" style={{ textAlign: 'center', fontVariant: ['tabular-nums'] }} accessibilityElementsHidden importantForAccessibility="no">
                  {!load
                    ? `Lighter than the ${formatLoad(bar)} lb bar`
                    : load.perSide.length === 0
                      ? 'Just the bar'
                      : `${describePlates(load.perSide)} each side`}
                </BlancText>
                {/* Between plate steps, the closest weight under it is drawn: say so. */}
                {load && !load.exact ? (
                  <BlancText variant="footnote" tone="graphite" style={{ textAlign: 'center' }}>
                    {`Loads ${formatLoad(load.total)} lb, the closest under ${formatLoad(working)}`}
                  </BlancText>
                ) : null}
              </View>
            </View>
            <Hairline />
            <MenuRow
              label="Bar"
              value={String(bar)}
              options={BAR_CHOICES_LB.map((choice) => ({ value: String(choice), label: `${choice} lb` }))}
              onChange={(next) => setBarWeight(id, Number(next))}
            />
          </Label>
        </Section>
      ) : null}

      {/* Nothing to show (no weight typed yet): say what the sheet needs. */}
      {steps.length === 0 && !(barbell && working !== null) ? (
        <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 22, textAlign: 'center' }}>
          Enter the weight on the set card first.
        </BlancText>
      ) : null}
    </>
  );

  // The sheet fits its content; at the accessibility text sizes, or with a
  // long ramp, it can be taller than the screen, so it scrolls there.
  return large ? (
    <ScrollView style={{ backgroundColor: c.ground }} contentContainerStyle={{ paddingBottom: 36 }}>
      {content}
    </ScrollView>
  ) : (
    <View style={{ backgroundColor: c.ground, paddingBottom: 24 }}>{content}</View>
  );
}
