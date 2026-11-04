import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActionSheetIOS } from 'react-native';

import { whoopSyncMessage, whoopSyncedLabel } from '@/lib/whoopStatus';
import { useAppStore } from '@/stores/appStore';
import { FormNote, ToggleRow } from '~/components/Form';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { TabScroll } from '~/components/TabScroll';
import { haptics } from '~/lib/haptics';
import { connectOrSyncHealth, connectWhoop, stopHealthSync, useHealthStore } from '~/lib/you';

/** WHOOP (workouts and recovery stats) and Apple Health (body weight). */
export default function ConnectionsScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Connections' }} />
      <TabScroll>
        <Whoop />
        <Health />
      </TabScroll>
    </>
  );
}

function Whoop() {
  const connection = useAppStore((state) => state.whoopConnection);
  const [action, setAction] = useState<'connect' | 'sync' | 'disconnect' | null>(null);
  const [message, setMessage] = useState<{ text: string; alert?: boolean } | null>(null);

  useEffect(() => {
    void useAppStore.getState().fetchWhoopConnection();
  }, []);

  const connect = async () => {
    if (action) return;
    setAction('connect');
    setMessage(null);
    const result = await connectWhoop();
    setAction(null);
    if (!result) return;
    if (result.ok) haptics.success();
    else haptics.error();
    // The Connected row and the haptic say it worked; only a failure needs words.
    if (!result.ok) setMessage({ text: result.message, alert: true });
  };

  const sync = async () => {
    if (action) return;
    setAction('sync');
    setMessage(null);
    try {
      const result = await useAppStore.getState().syncWhoop();
      if (result) haptics.success();
      else haptics.error();
      setMessage({ text: whoopSyncMessage(result), alert: !result });
    } catch {
      haptics.error();
      setMessage({ text: 'Sync failed. Try again later.', alert: true });
    } finally {
      setAction(null);
    }
  };

  // Asks first in an action sheet, as Sign out does.
  const disconnect = async () => {
    if (action) return;
    const sure = await new Promise<boolean>((resolve) =>
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: 'Disconnect WHOOP?',
          message: 'Activities already imported stay in History.',
          options: ['Disconnect', 'Cancel'],
          destructiveButtonIndex: 0,
          cancelButtonIndex: 1,
        },
        (index) => resolve(index === 0),
      ),
    );
    if (!sure) return;
    setAction('disconnect');
    setMessage(null);
    try {
      await useAppStore.getState().disconnectWhoop();
      haptics.success();
    } catch {
      haptics.error();
      setMessage({ text: 'Could not disconnect WHOOP.', alert: true });
    } finally {
      setAction(null);
    }
  };

  const synced = connection ? whoopSyncedLabel(connection) : '';
  const status = connection ? synced.charAt(0).toUpperCase() + synced.slice(1) : undefined;

  return (
    <Section title="WHOOP" style={{ marginTop: 8 }}>
      <Label style={{ overflow: 'hidden' }}>
        {connection ? (
          // The status alone: Sync now and Disconnect are the rows under it.
          <>
            <Row title="Connected" detail={status} />
            <Hairline />
            <Row title={action === 'sync' ? 'Syncing…' : 'Sync now'} disabled={action !== null} onPress={() => void sync()} />
            <Hairline />
            <Row title="Disconnect" destructive disabled={action !== null} onPress={() => void disconnect()} />
          </>
        ) : (
          <Row
            title={action === 'connect' ? 'Connecting…' : 'Connect WHOOP'}
            chevron={action === null}
            disabled={action !== null}
            onPress={() => void connect()}
          />
        )}
      </Label>
      <FormNote alert={message?.alert}>
        {message?.text ?? 'Workouts from WHOOP show in History and sync each time you open the app.'}
      </FormNote>
    </Section>
  );
}

function Health() {
  const enabled = useHealthStore((state) => state.enabled);
  const busy = useHealthStore((state) => state.busy);
  const message = useHealthStore((state) => state.message);

  const toggle = (next: boolean) => {
    if (next) {
      void connectOrSyncHealth().then((ok) => (ok ? haptics.success() : haptics.error()));
    } else {
      stopHealthSync();
    }
  };

  return (
    <Section title="Apple Health">
      <Label>
        <ToggleRow list label="Weight from Apple Health" value={enabled} disabled={busy} onChange={toggle} />
        {enabled ? (
          <>
            <Hairline />
            <Row
              title={busy ? 'Syncing…' : 'Sync now'}
              disabled={busy}
              onPress={() => void connectOrSyncHealth().then((ok) => (ok ? haptics.success() : haptics.error()))}
            />
          </>
        ) : null}
      </Label>
      <FormNote alert={message?.alert}>
        {message?.text ??
          'Imports body-weight readings, including those from smart scales. Turning it off keeps what was imported.'}
      </FormNote>
    </Section>
  );
}
