import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { getFoodTrialStatus } from '@/lib/foodTrial';
import { foodTrialUsageLine } from '@/lib/foodTrialUsage';
import { getPhotoWorkerSettings } from '@/lib/photoAnalysis';
import { supabase } from '@/lib/supabase';
import { ChoiceRow, FormNote } from '~/components/Form';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { TabScroll } from '~/components/TabScroll';
import { announce } from '~/lib/accessibility';
import { chooseAnalysisMode, useAnalysisModeStore, type AnalysisMode } from '~/lib/you';
import { space } from '~/theme/blanc';

const MODES: { mode: AnalysisMode; title: string; detail: string }[] = [
  { mode: 'gemini', title: 'Gemini', detail: 'Hosted, with nutrition lookup' },
  { mode: 'worker', title: 'Your Mac', detail: 'Your Codex or Claude worker' },
];

/** How Log food's AI reads a meal, today's hosted usage, and the Mac worker. */
export default function AnalysisScreen() {
  const mode = useAnalysisModeStore((state) => state.mode);
  const [usage, setUsage] = useState<{ text: string; failed?: boolean } | null>(null);
  const [worker, setWorker] = useState(() => getPhotoWorkerSettings().url);

  // Read again on the way back: the address is saved on the Mac worker screen,
  // which opens on top of this one.
  useFocusEffect(
    useCallback(() => {
      setWorker(getPhotoWorkerSettings().url);
    }, []),
  );

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
        if (current) {
          setUsage({ text: line });
          // Arrives after a network check, so VoiceOver hears it; errors
          // announce themselves (FormNote alert).
          announce(line);
        }
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
              <ChoiceRow {...option} checked={mode === option.mode} onPress={() => chooseAnalysisMode(option.mode)} />
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
