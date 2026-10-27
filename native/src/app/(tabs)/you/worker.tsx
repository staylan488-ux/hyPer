import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack, useNavigation, usePreventRemove } from 'expo-router';
import { useState } from 'react';
import { Keyboard, View } from 'react-native';

import { checkPhotoWorker, getPhotoWorkerSettings, savePhotoWorkerSettings, type PhotoWorkerSettings } from '@/lib/photoAnalysis';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { FieldRow, FormNote } from '~/components/Form';
import { Label } from '~/components/Label';
import { Hairline } from '~/components/Row';
import { TabScroll } from '~/components/TabScroll';
import { haptics } from '~/lib/haptics';
import { confirmAlert } from '~/lib/program';
import { isPreviewActive } from '~/platform/previewFlag';
import { space } from '~/theme/blanc';

/** The Mac worker: its address and photo provider, saved and tested together. */
export default function WorkerScreen() {
  const navigation = useNavigation();
  const [saved, setSaved] = useState<PhotoWorkerSettings>(getPhotoWorkerSettings);
  const [draft, setDraft] = useState<PhotoWorkerSettings>(saved);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; alert?: boolean } | null>(null);
  const dirty = draft.url !== saved.url || draft.provider !== saved.provider;

  usePreventRemove(dirty, ({ data }) => {
    if (busy) return;
    void confirmAlert({ title: 'Discard your changes?', confirmLabel: 'Discard', cancelLabel: 'Keep editing', destructive: true }).then(
      (discard) => {
        if (discard) navigation.dispatch(data.action);
      },
    );
  });

  const save = async () => {
    if (busy) return;
    Keyboard.dismiss();
    setMessage(null);
    if (isPreviewActive()) {
      const next = { ...draft, url: draft.url.trim().replace(/\/+$/, '') };
      setSaved(next);
      setDraft(next);
      setMessage({ text: 'Saved in sample mode. No connection was made.' });
      return;
    }
    savePhotoWorkerSettings(draft);
    const next = getPhotoWorkerSettings();
    setSaved(next);
    setDraft(next);
    setBusy(true);
    const status = await checkPhotoWorker(next);
    setBusy(false);
    if (status.ok) {
      haptics.success();
      setMessage({ text: `Connected. Signed in: ${status.authenticatedProviders.join(', ') || 'none'}.` });
    } else {
      haptics.error();
      setMessage({ text: `Saved, but the worker is offline: ${status.error || 'connection failed'}`, alert: true });
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Mac worker' }} />
      <TabScroll keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Label style={{ marginTop: 12 }}>
          <FieldRow
            label="Address"
            wide
            value={draft.url}
            placeholder="https://your-mac.example"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onChangeText={(url) => setDraft((current) => ({ ...current, url }))}
          />
          <Hairline />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingLeft: 18, paddingRight: 16 }}>
            <BlancText variant="body" style={{ flex: 1 }}>
              Photos
            </BlancText>
            <Host matchContents style={{ width: 170 }}>
              <Picker
                selection={draft.provider}
                onSelectionChange={(provider) => {
                  haptics.select();
                  setDraft((current) => ({ ...current, provider: provider as PhotoWorkerSettings['provider'] }));
                }}
                modifiers={[pickerStyle('segmented')]}>
                <SwiftText modifiers={[tag('openai')]}>Codex</SwiftText>
                <SwiftText modifiers={[tag('anthropic')]}>Claude</SwiftText>
              </Picker>
            </Host>
          </View>
        </Label>
        <FormNote>On a phone, use the worker’s Tailscale HTTPS address. It signs in with your own Codex or Claude login.</FormNote>
        <View style={{ marginHorizontal: space.inset, marginTop: 22 }}>
          <Capsule title="Save and test" fill busy={busy} disabled={!draft.url.trim()} onPress={() => void save()} />
        </View>
        {message ? <FormNote alert={message.alert}>{message.text}</FormNote> : null}
      </TabScroll>
    </>
  );
}
