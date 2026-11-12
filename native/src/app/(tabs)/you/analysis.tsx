import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { getFoodTrialStatus } from '@/lib/foodTrial';
import { foodTrialUsageLine } from '@/lib/foodTrialUsage';
import { getPhotoWorkerSettings } from '@/lib/photoAnalysis';
import { supabase } from '@/lib/supabase';
import { ChoiceRow, FormNote, ToggleRow } from '~/components/Form';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { TabScroll } from '~/components/TabScroll';
import { announce } from '~/lib/accessibility';
import { askAiConsent, setAiConsent, useAiConsentStore } from '~/lib/aiConsent';
import { useEarlyAccess } from '~/lib/earlyAccess';
import { chooseAnalysisMode, useAnalysisModeStore, type AnalysisMode } from '~/lib/you';
import { space } from '~/theme/blanc';

const MODES: { mode: AnalysisMode; title: string; detail: string }[] = [
  { mode: 'gemini', title: 'Gemini', detail: 'Hosted, with nutrition lookup' },
  { mode: 'worker', title: 'Your Mac', detail: 'Your Codex or Claude worker' },
];

/**
 * How Log food's AI reads a meal, today's hosted usage, and whether food may
 * go to Gemini at all. The Mac worker is an early feature (the accounts from
 * before public sign-up); everyone else has Gemini only.
 */
export default function AnalysisScreen() {
  const early = useEarlyAccess();
  const chosen = useAnalysisModeStore((state) => state.mode);
  const mode = early ? chosen : 'gemini';
  const allowed = useAiConsentStore((state) => state.granted);
  // The permission alert is up: the switch waits for its answer.
  const [asking, setAsking] = useState(false);
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
    // The count is only shown once sending is allowed.
    if (mode !== 'gemini' || !allowed) return;
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
  }, [mode, allowed]);

  return (
    <>
      <Stack.Screen options={{ title: 'Food analysis' }} />
      <TabScroll>
        {early ? (
          <Label style={{ marginTop: 12 }}>
            {MODES.map((option, index) => (
              <View key={option.mode}>
                {index > 0 ? <Hairline /> : null}
                <ChoiceRow {...option} checked={mode === option.mode} onPress={() => chooseAnalysisMode(option.mode)} />
              </View>
            ))}
          </Label>
        ) : null}
        {mode === 'gemini' ? (
          <>
            {/* The permission asked before the first analysis, and the way to take it back. */}
            <Label style={{ marginTop: 12 }}>
              <ToggleRow
                list
                label="Send food to Gemini"
                detail="Google’s AI, for meal estimates and suggested targets"
                value={allowed}
                disabled={asking}
                onChange={(next) => {
                  if (!next) {
                    setAiConsent(false);
                    return;
                  }
                  setAsking(true);
                  void askAiConsent().finally(() => setAsking(false));
                }}
              />
            </Label>
            {allowed ? (
              <FormNote alert={usage?.failed}>{usage ? usage.text : 'Checking today’s usage…'}</FormNote>
            ) : (
              <FormNote>Nothing is sent. Analyze meal and Suggest targets ask first.</FormNote>
            )}
          </>
        ) : (
          <FormNote>Photos go to your Mac worker, which needs to be running.</FormNote>
        )}

        {early ? (
          <>
            <Label style={{ marginTop: space.section }}>
              <Row title="Mac worker" value={worker ? hostOf(worker) : 'Not set'} chevron onPress={() => router.push('/you/worker')} />
            </Label>
            <FormNote>Suggest targets in Targets uses the same choice.</FormNote>
          </>
        ) : null}
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
