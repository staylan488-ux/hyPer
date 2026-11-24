import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, RefreshControl, Share, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { agentDetail, MCP_SERVER_URL, type AgentGrant } from '@/lib/agentGrants';
import { onAppVisible } from '@/lib/appVisibility';
import { whoopSyncMessage, whoopSyncedLabel } from '@/lib/whoopStatus';
import { useAppStore } from '@/stores/appStore';
import { FormNote, ToggleRow } from '~/components/Form';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { SwipeRow } from '~/components/SwipeRow';
import { TabScroll } from '~/components/TabScroll';
import { announce, useAnnounce } from '~/lib/accessibility';
import { useCurrentDayKey } from '~/lib/accountData';
import { useEarlyAccess } from '~/lib/earlyAccess';
import { haptics } from '~/lib/haptics';
import { rowEnter, rowExit, rowLayout } from '~/lib/motion';
import {
  connectOrSyncHealth,
  connectWhoop,
  disconnectAgent,
  loadAgentGrants,
  stopHealthSync,
  useAgentGrantsStore,
  useHealthStore,
  usePullRefresh,
} from '~/lib/you';

import { copyText } from '../../../../modules/hyper-view';

/**
 * AI agents (remote MCP via OAuth 2.1), WHOOP (workouts and recovery stats)
 * and Apple Health (body weight). WHOOP is an early feature: WHOOP lets an
 * unreviewed app connect only a few people, so only the accounts from before
 * public sign-up see it, and anyone already connected keeps it to sync or
 * disconnect.
 */
export default function ConnectionsScreen() {
  const early = useEarlyAccess();
  const connected = useAppStore((state) => Boolean(state.whoopConnection));
  const { refreshing, refresh } = usePullRefresh(async () => {
    await Promise.allSettled([
      loadAgentGrants(),
      early || connected ? useAppStore.getState().fetchWhoopConnection() : Promise.resolve(),
    ]);
  });
  return (
    <>
      <Stack.Screen options={{ title: 'Connections' }} />
      <TabScroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
        <Agents />
        {early || connected ? <Whoop /> : null}
        <Health />
      </TabScroll>
    </>
  );
}

function Agents() {
  const grants = useAgentGrantsStore((state) => state.grants);
  const loading = useAgentGrantsStore((state) => state.loading);
  const failed = useAgentGrantsStore((state) => state.failed);
  const todayKey = useCurrentDayKey();
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFocusEffect(
    useCallback(() => {
      void loadAgentGrants();
    }, []),
  );

  useEffect(() => onAppVisible(() => {
    void loadAgentGrants();
  }), []);

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  const shareAddress = async () => {
    await Share.share({ message: MCP_SERVER_URL }).catch(() => {});
  };

  const copyAddress = async () => {
    const ok = await copyText(MCP_SERVER_URL);
    if (!ok) {
      await shareAddress();
      return;
    }
    haptics.success();
    setCopied(true);
    announce('Server address copied');
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 2000);
  };

  const disconnect = async (grant: AgentGrant) => {
    const ok = await disconnectAgent(grant);
    if (ok) {
      haptics.success();
      announce(`${grant.name} disconnected`);
    } else {
      haptics.error();
      Alert.alert('Not disconnected', 'Check your connection and try again.');
    }
  };

  const confirmDisconnect = (grant: AgentGrant) => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: `Disconnect ${grant.name}?`,
        message: 'It will no longer be able to read or log to hyPer. Anything already logged stays.',
        options: ['Disconnect', 'Cancel'],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      (index) => {
        if (index === 0) void disconnect(grant);
      },
    );
  };

  const shown = grants ?? [];
  const note = failed
    ? shown.length > 0
      ? { text: 'Couldn’t refresh connected agents. Pull down to try again.', alert: true }
      : { text: 'Couldn’t load connected agents. Check your connection and try again.', alert: true }
    : grants === null && loading
      ? { text: 'Checking connected agents…' }
      : shown.length > 0
        ? { text: 'Add this address in Claude or another MCP app to log food and weigh-ins. Swipe or tap an agent to disconnect it.' }
        : { text: 'Paste this address into Claude or another MCP app, then sign in to read your day and log food or weigh-ins.' };

  return (
    <Section title="AI agents" style={{ marginTop: 8 }}>
      <Label style={{ overflow: 'hidden' }} layout={rowLayout}>
        <Row
          title="Server address"
          detail={MCP_SERVER_URL}
          value={copied ? 'Copied' : 'Copy'}
          accessibilityLabel={`Server address, ${MCP_SERVER_URL}, ${copied ? 'copied' : 'copy'}`}
          onPress={() => void copyAddress()}
          menu={[
            { title: 'Copy address', symbol: 'doc.on.doc', run: () => void copyAddress() },
            { title: 'Share address', symbol: 'square.and.arrow.up', run: () => void shareAddress() },
          ]}
        />
        {failed && shown.length === 0 ? (
          <Animated.View entering={rowEnter} exiting={rowExit} layout={rowLayout}>
            <Hairline />
            <Row title="Try again" onPress={() => void loadAgentGrants()} />
          </Animated.View>
        ) : null}
        {shown.map((grant) => (
          <Animated.View key={grant.clientId} entering={rowEnter} exiting={rowExit} layout={rowLayout}>
            <Hairline />
            <SwipeRow
              name={grant.name}
              actions={[{ label: 'Disconnect', destructive: true, onPress: () => void disconnect(grant) }]}>
              <View>
                <Row
                  title={grant.name}
                  detail={agentDetail(grant, todayKey)}
                  onPress={() => confirmDisconnect(grant)}
                  menu={[
                    {
                      title: 'Disconnect',
                      subtitle: 'Logged entries stay',
                      symbol: 'xmark.circle',
                      destructive: true,
                      removes: true,
                      run: () => void disconnect(grant),
                    },
                  ]}
                />
              </View>
            </SwipeRow>
          </Animated.View>
        ))}
      </Label>
      <FormNote alert={note.alert}>{note.text}</FormNote>
    </Section>
  );
}

function Whoop() {
  const connection = useAppStore((state) => state.whoopConnection);
  const [action, setAction] = useState<'connect' | 'sync' | 'disconnect' | null>(null);
  const [message, setMessage] = useState<{ text: string; alert?: boolean } | null>(null);
  // How a connect, sync or disconnect ended; errors announce themselves (FormNote).
  useAnnounce(message && !message.alert ? message.text : null);

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
    }
    setAction(null);
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
    }
    setAction(null);
  };

  const synced = connection ? whoopSyncedLabel(connection) : '';
  const status = connection ? synced.charAt(0).toUpperCase() + synced.slice(1) : undefined;

  return (
    <Section title="WHOOP">
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
  // How a sync ended, not one left from an earlier visit; errors announce themselves (FormNote).
  const [earlier] = useState(message);
  useAnnounce(message && message !== earlier && !message.alert ? message.text : null);

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
