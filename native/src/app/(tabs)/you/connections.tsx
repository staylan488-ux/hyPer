import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActionSheetIOS, View } from 'react-native';

import { whoopSyncMessage, whoopSyncedLabel } from '@/lib/whoopStatus';
import { useAppStore } from '@/stores/appStore';
import { Capsule } from '~/components/Capsule';
import { FormNote, ToggleRow } from '~/components/Form';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { SwipeRow } from '~/components/SwipeRow';
import { TabScroll } from '~/components/TabScroll';
import { haptics } from '~/lib/haptics';
import { confirmAlert } from '~/lib/program';
import { connectOrSyncHealth, connectWhoop, stopHealthSync, useHealthStore } from '~/lib/you';
import { space, useBlanc } from '~/theme/blanc';

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
  const c = useBlanc();
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
    setMessage({ text: result.message, alert: !result.ok });
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

  const disconnect = async () => {
    if (action) return;
    const sure = await confirmAlert({
      title: 'Disconnect WHOOP?',
      message: 'Activities already imported stay in History.',
      confirmLabel: 'Disconnect',
      destructive: true,
    });
    if (!sure) return;
    setAction('disconnect');
    setMessage(null);
    try {
      await useAppStore.getState().disconnectWhoop();
      haptics.success();
      setMessage({ text: 'WHOOP disconnected.' });
    } catch {
      haptics.error();
      setMessage({ text: 'Could not disconnect WHOOP.', alert: true });
    } finally {
      setAction(null);
    }
  };

  const synced = connection ? whoopSyncedLabel(connection) : '';
  const status = action === 'sync' ? 'Syncing recent workouts…' : connection ? synced.charAt(0).toUpperCase() + synced.slice(1) : undefined;

  // The connection's own actions, from a tap or a hold on it.
  const menu = () =>
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: 'WHOOP',
        message: status,
        options: ['Sync now', 'Disconnect', 'Cancel'],
        destructiveButtonIndex: 1,
        cancelButtonIndex: 2,
      },
      (index) => {
        if (index === 0) void sync();
        if (index === 1) void disconnect();
      },
    );

  return (
    <Section title="WHOOP" style={{ marginTop: 8 }}>
      <Label style={{ overflow: 'hidden' }}>
        {connection ? (
          // Swipe for Sync and Disconnect (which still asks first).
          <SwipeRow
            name="WHOOP"
            actions={[
              { label: 'Sync', onPress: () => void sync() },
              { label: 'Disconnect', destructive: true, onPress: () => void disconnect() },
            ]}>
            <View style={{ backgroundColor: c.label }}>
              <Row
                title="Connected"
                detail={status}
                onPress={action ? undefined : menu}
                onLongPress={action ? undefined : { label: 'More actions', run: menu }}
              />
            </View>
          </SwipeRow>
        ) : (
          <Row title="Not connected" />
        )}
        {connection ? (
          <>
            <Hairline />
            <Row title={action === 'sync' ? 'Syncing' : 'Sync now'} disabled={action !== null} onPress={() => void sync()} />
            <Hairline />
            <Row title="Disconnect" destructive disabled={action !== null} onPress={() => void disconnect()} />
          </>
        ) : null}
      </Label>
      {connection ? null : (
        <View style={{ marginHorizontal: space.inset, marginTop: 14 }}>
          <Capsule title="Connect WHOOP" fill busy={action === 'connect'} onPress={() => void connect()} />
        </View>
      )}
      <FormNote alert={message?.alert}>
        {message?.text ?? 'Workouts from WHOOP show in History; they sync each time you open the app.'}
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
        <ToggleRow label="Weight from Apple Health" value={enabled} disabled={busy} onChange={toggle} />
        {enabled ? (
          <>
            <Hairline />
            <Row
              title={busy ? 'Syncing' : 'Sync now'}
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
