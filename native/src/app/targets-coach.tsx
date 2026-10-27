import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Keyboard, ScrollView, TextInput, View } from 'react-native';

import { getBodyWeightHistorySince } from '@/lib/healthWeights';
import { buildCoachContext, requestCoachRecommendation, type CoachRecommendation } from '@/lib/nutritionCoach';
import { COACH_GOALS_KEY } from '@/lib/photoAnalysis';
import { supabase } from '@/lib/supabase';
import { buildWeightTrend } from '@/lib/weightTrend';
import { useAppStore } from '@/stores/appStore';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { FormNote, ToggleRow } from '~/components/Form';
import { GlassButton } from '~/components/GlassButton';
import { Label } from '~/components/Label';
import { Row } from '~/components/Row';
import { haptics } from '~/lib/haptics';
import { isPreviewActive } from '~/platform/previewFlag';
import { stageTargets, useWeightStore } from '~/lib/you';
import { type as typeScale, useBlanc } from '~/theme/blanc';

const PREVIEW_SUGGESTION: CoachRecommendation = {
  calories: 2400,
  protein: 170,
  carbs: 268,
  fat: 72,
  rationale:
    'Sample suggestion: this example keeps protein steady and adjusts the daily calorie target. With your account, the coach explains suggestions from your profile and what you choose to share.',
  cautions: 'Sample numbers for trying the screen; not personalized.',
  confidence: 0.7,
  provider: 'preview',
  reconciled: false,
};

/**
 * Suggest targets: describe the goal in your words and the coach (on your
 * Mac worker) proposes numbers, which open in the edit sheet to review.
 */
export default function TargetsCoachSheet() {
  const c = useBlanc();
  const profile = useAppStore((state) => state.nutritionProfile);
  const target = useAppStore((state) => state.macroTarget);
  const latestKg = useWeightStore((state) => (state.history[0] ? Number(state.history[0].kilograms) : null));
  const [goals, setGoals] = useState(() => globalThis.localStorage?.getItem(COACH_GOALS_KEY) ?? '');
  const [share, setShare] = useState(true);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CoachRecommendation | null>(null);

  useEffect(() => {
    if (!result) return;
    stageTargets({ ...result, source: 'manual' }, { coach: result });
    router.replace('/targets-edit');
  }, [result]);

  const ask = async () => {
    if (!profile || asking) return;
    Keyboard.dismiss();
    setAsking(true);
    setError(null);
    try {
      if (isPreviewActive()) {
        setResult(PREVIEW_SUGGESTION);
        haptics.success();
        return;
      }
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      const userId = data.session?.user?.id;
      if (!accessToken || !userId) throw new Error('Your session expired. Sign out and back in.');
      let trendKgPerWeek: number | null = null;
      if (share) {
        try {
          trendKgPerWeek = buildWeightTrend(await getBodyWeightHistorySince(userId, 21), { windowDays: 21 }).kgPerWeek;
        } catch {
          // A missing trend does not stop a suggestion from the basic stats.
        }
      }
      const suggestion = await requestCoachRecommendation({
        goals,
        context: buildCoachContext(profile, latestKg, target, { trendKgPerWeek, shareMeasured: share }),
        accessToken,
      });
      haptics.success();
      setResult(suggestion);
    } catch (caught) {
      haptics.error();
      setError(caught instanceof Error ? caught.message : 'The coach is unavailable right now.');
    } finally {
      setAsking(false);
    }
  };

  return (
    <ScrollView style={{ backgroundColor: c.ground }} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16 }}>
        <GlassButton symbol="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <BlancText variant="headline" accessibilityRole="header">
            Suggest targets
          </BlancText>
        </View>
        <View style={{ width: 44 }} />
      </View>

      {!profile ? (
        <>
          <Label style={{ marginTop: 20 }}>
            <Row title="Calculate targets first" detail="The coach needs your basic stats" chevron onPress={() => router.replace('/targets-calculate')} />
          </Label>
          <FormNote>Your goal text stays here while you set up your profile.</FormNote>
        </>
      ) : null}

      <Label style={{ marginTop: 20, padding: 14 }}>
        <TextInput
          value={goals}
          onChangeText={(text) => {
            setError(null);
            setGoals(text);
            // Kept as typed, so closing the sheet never loses it.
            globalThis.localStorage?.setItem(COACH_GOALS_KEY, text);
          }}
          editable={!asking}
          multiline
          maxLength={2000}
          placeholder="For example: keep my weight while getting stronger. I lift four times a week."
          placeholderTextColor={c.upcoming}
          accessibilityLabel="Your goal"
          style={[typeScale.body, { color: c.ink, minHeight: 120, textAlignVertical: 'top', padding: 4 }]}
        />
      </Label>

      <Label style={{ marginTop: 16 }}>
        <ToggleRow label="Share daily burn and weight trend" value={share} disabled={asking} onChange={setShare} />
      </Label>
      <FormNote>Your profile, current targets and goal are sent either way. The coach runs on your Mac worker.</FormNote>

      {error ? (
        <BlancText variant="footnote" tone="live" style={{ marginHorizontal: 32, marginTop: 12 }} accessibilityRole="alert">
          {error}
        </BlancText>
      ) : null}
      <View style={{ marginHorizontal: 16, marginTop: 24 }}>
        <Capsule
          title={asking ? 'Asking the coach' : 'Get suggestions'}
          size="large"
          fill
          busy={asking}
          disabled={!profile || goals.trim().length < 5}
          onPress={() => void ask()}
        />
      </View>
      {asking ? <FormNote>This can take a minute or two.</FormNote> : null}
    </ScrollView>
  );
}
