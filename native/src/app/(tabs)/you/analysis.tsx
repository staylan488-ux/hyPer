import { router, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { getFoodTrialStatus } from '@/lib/foodTrial';
import { foodTrialUsageLine } from '@/lib/foodTrialUsage';
import { getPhotoWorkerSettings } from '@/lib/photoAnalysis';
import { supabase } from '@/lib/supabase';
import { BlancText } from '~/components/BlancText';
import { FormNote } from '~/components/Form';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { TabScroll } from '~/components/TabScroll';
import { haptics } from '~/lib/haptics';
import { chooseAnalysisMode, useAnalysisModeStore, type AnalysisMode } from '~/lib/you';
import { space, useBlanc } from '~/theme/blanc';

const MODES: { mode: AnalysisMode; title: string; detail: string }[] = [
  { mode: 'gemini', title: 'Gemini', detail: 'Hosted, with nutrition lookup' },
  { mode: 'worker', title: 'Your Mac', detail: 'Your Codex or Claude worker' },
];

/** How Log food's AI reads a meal, today's hosted usage, and the Mac worker. */
export default function AnalysisScreen() {
  const mode = useAnalysisModeStore((state) => state.mode);
  const [usage, setUsage] = useState<{ text: string; failed?: boolean } | null>(null);
  const worker = getPhotoWorkerSettings().url;

  useEffect(() => {
    if (mode !== 'gemini') return;
    let current = true;
    setUsage(null);
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error('Sign in again to check usage.');
        const line = foodTrialUsageLine(await getFoodTrialStatus(token));
        if (current) setUsage({ text: line });
      } catch (error) {
        if (current) setUsage({ text: error instanceof Error ? error.message : 'Could not check usage.', failed: true });
      }
    })();
    return () => {
      current = false;
    };
  }, [mode]);

  return (
    <>
      <Stack.Screen options={{ title: 'Food analysis' }} />
      <TabScroll>
        <Label style={{ marginTop: 12 }}>
          {MODES.map((option, index) => (
            <View key={option.mode}>
              {index > 0 ? <Hairline /> : null}
              <ModeRow {...option} checked={mode === option.mode} onPress={() => chooseAnalysisMode(option.mode)} />
            </View>
          ))}
        </Label>
        {mode === 'gemini' ? (
          <FormNote alert={usage?.failed}>{usage ? usage.text : 'Checking today’s usage…'}</FormNote>
        ) : (
          <FormNote>Photos go to your Mac worker, which needs to be running.</FormNote>
        )}

        <Label style={{ marginTop: space.section }}>
          <Row title="Mac worker" value={worker ? hostOf(worker) : 'Not set'} chevron onPress={() => router.push('/you/worker')} />
        </Label>
        <FormNote>Suggest targets in Targets uses the same choice.</FormNote>
      </TabScroll>
    </>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function ModeRow({ title, detail, checked, onPress }: { title: string; detail: string; checked: boolean; onPress: () => void }) {
  const c = useBlanc();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked }}
      accessibilityLabel={`${title}, ${detail}`}
      onPress={() => {
        if (!checked) haptics.select();
        onPress();
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 60,
        paddingVertical: 10,
        paddingLeft: 18,
        paddingRight: 16,
        backgroundColor: pressed ? c.pressed : 'transparent',
      })}>
      <View style={{ flex: 1 }}>
        <BlancText variant="bodyStrong">{title}</BlancText>
        <BlancText variant="secondary" tone="graphite" style={{ marginTop: 1 }}>
          {detail}
        </BlancText>
      </View>
      {checked ? <SymbolView name="checkmark" size={15} weight="semibold" tintColor={c.ink} /> : null}
    </Pressable>
  );
}
