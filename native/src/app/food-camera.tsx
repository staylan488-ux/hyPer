import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Device from 'expo-device';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { onAppVisible } from '@/lib/appVisibility';
import { blancTextStyle, textSizing } from '~/components/BlancText';
import { CAMERA_OFF, CAMERA_UNAVAILABLE, choosePhotoFromLibrary, settleFoodCamera, type CameraOutcome, type PickedPhoto } from '~/fuel/foodCamera';
import { announce, useIncreaseContrast } from '~/lib/accessibility';
import { haptics } from '~/lib/haptics';
import { paletteFor, type Palette } from '~/theme/blanc';

/**
 * Log food's camera (opened by `openFoodCamera`): full screen, as iOS's own
 * cameras are. The shutter is centred at the foot and the photo library sits
 * bottom left, so an existing photo is one tap away instead of a choice asked
 * first. A shot shows for Retake or Use Photo. Without camera access (or a
 * camera: the simulator) it says so, with Choose from library right under
 * the words (and Open Settings when access is off); the library button stays.
 */
export default function FoodCamera() {
  const insets = useSafeAreaInsets();
  // Camera chrome is black in either appearance, so its words and fills are the dark palette's.
  const c = paletteFor(true, useIncreaseContrast());
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [mountFailed, setMountFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [taking, setTaking] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [flash, setFlash] = useState<'off' | 'on'>('off');
  const [shot, setShot] = useState<PickedPhoto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const camera = useRef<CameraView>(null);
  // What the tab hears once this screen has gone: closing is no photo.
  const outcome = useRef<CameraOutcome>({ photo: null });
  useEffect(() => () => settleFoodCamera(outcome.current), []);

  const state = !Device.isDevice || mountFailed
    ? 'unavailable'
    : !permission || (!permission.granted && permission.status === 'undetermined')
      ? 'asking'
      : permission.granted
        ? 'live'
        : 'off';

  // Asked for as the camera opens, the first time only (iOS asks once).
  useEffect(() => {
    if (Device.isDevice && permission?.status === 'undetermined') void requestPermission();
  }, [permission?.status, requestPermission]);
  // Back from Settings with access turned on.
  useEffect(() => onAppVisible(() => void getPermission()), [getPermission]);

  const leave = (next: CameraOutcome) => {
    outcome.current = next;
    router.back();
  };
  const close = () => {
    haptics.tap();
    // The tab says why there was no photo, with Open Settings when access is off.
    leave(state === 'off' ? { error: CAMERA_OFF } : state === 'unavailable' ? { error: CAMERA_UNAVAILABLE } : { photo: null });
  };

  const take = async () => {
    if (!ready || taking || state !== 'live') return;
    haptics.tap();
    setTaking(true);
    setError(null);
    try {
      const picture = await camera.current?.takePictureAsync({ quality: 1, exif: false });
      if (!picture) return;
      setShot({ uri: picture.uri, width: picture.width, height: picture.height });
      announce('Photo taken');
    } catch {
      setError('Couldn’t take the photo. Try again.');
      announce('Couldn’t take the photo. Try again.');
    } finally {
      setTaking(false);
    }
  };

  const library = async () => {
    if (choosing || taking) return;
    haptics.tap();
    setChoosing(true);
    setError(null);
    try {
      const photo = await choosePhotoFromLibrary();
      // Cancelled: back to the camera, as in Messages.
      if (photo) leave({ photo });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Couldn’t open your photos.';
      setError(message);
      announce(message);
    } finally {
      setChoosing(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000000', paddingTop: insets.top, paddingBottom: insets.bottom }}>
      {/* Close, and the flash while the camera runs. */}
      <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 }}>
        <RoundButton c={c} symbol="xmark" label="Close" onPress={close} />
        {state === 'live' && !shot ? (
          <RoundButton
            c={c}
            symbol={flash === 'on' ? 'bolt.fill' : 'bolt.slash.fill'}
            label="Flash"
            value={flash === 'on' ? 'On' : 'Off'}
            onPress={() => {
              haptics.select();
              setFlash((current) => (current === 'on' ? 'off' : 'on'));
            }}
          />
        ) : null}
      </View>

      {/* The photo's own 3:4 frame, so what shows is what is taken. */}
      <View style={{ flex: 1, justifyContent: 'center', overflow: 'hidden' }}>
        <View style={{ width: '100%', aspectRatio: 3 / 4, maxHeight: '100%', alignSelf: 'center', backgroundColor: '#000000' }}>
          {state === 'live' ? (
            <CameraView
              ref={camera}
              style={{ flex: 1 }}
              facing="back"
              mode="picture"
              flash={flash}
              // paused under the photo library
              active={!choosing && !shot}
              accessibilityLabel="Camera viewfinder"
              onCameraReady={() => setReady(true)}
              onMountError={() => setMountFailed(true)}
            />
          ) : null}
          {shot ? (
            <Image source={{ uri: shot.uri }} accessibilityLabel="The photo you took" style={{ position: 'absolute', inset: 0 }} contentFit="contain" />
          ) : null}
          {state === 'unavailable' || state === 'off' ? (
            <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 8 }}>
              <Text {...textSizing('headline')} accessibilityRole="header" style={[blancTextStyle(c, 'headline'), { textAlign: 'center' }]}>
                {state === 'off' ? 'Camera access is off' : CAMERA_UNAVAILABLE}
              </Text>
              <Text {...textSizing('secondary')} style={[blancTextStyle(c, 'secondary', 'graphite'), { textAlign: 'center' }]}>
                {state === 'off' ? 'Allow Camera for hyPer in Settings, or choose a photo from your library.' : 'Choose a photo from your library instead.'}
              </Text>
              {/* The way on, right under the words that name it; the library button bottom left stays. */}
              <View style={{ marginTop: 12, alignItems: 'center', gap: 10 }}>
                {state === 'off' ? (
                  <QuietCapsule
                    c={c}
                    title="Open Settings"
                    onPress={() => {
                      haptics.tap();
                      void Linking.openSettings();
                    }}
                  />
                ) : null}
                <QuietCapsule c={c} title="Choose from library" disabled={choosing} onPress={() => void library()} />
              </View>
            </View>
          ) : null}
        </View>
      </View>

      {error ? (
        <Text {...textSizing('secondary')} style={[blancTextStyle(c, 'secondary'), { textAlign: 'center', paddingHorizontal: 24, paddingTop: 10 }]}>
          {error}
        </Text>
      ) : null}

      {shot ? (
        // The shot: Retake or Use Photo, as iOS's camera asks.
        <View style={{ minHeight: 124, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 }}>
          <TextButton c={c} title="Retake" onPress={() => {
            haptics.tap();
            setShot(null);
          }} />
          <TextButton c={c} title="Use Photo" strong onPress={() => {
            haptics.tap();
            leave({ photo: shot });
          }} />
        </View>
      ) : (
        // Photo library bottom left, the shutter in the middle, the right left empty for balance.
        <View style={{ minHeight: 124, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24 }}>
          <View style={{ flex: 1, alignItems: 'flex-start' }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Photo library"
              accessibilityHint="Choose a photo you already have"
              accessibilityState={choosing ? { disabled: true } : undefined}
              disabled={choosing}
              onPress={() => void library()}
              hitSlop={6}
              style={({ pressed }) => ({ width: 52, height: 52, borderRadius: 10, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: c.fill, opacity: pressed ? 0.6 : 1 })}>
              <SymbolView name="photo.on.rectangle" size={22} tintColor={c.ink} />
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Take photo"
            accessibilityState={state !== 'live' || !ready || taking ? { disabled: true } : undefined}
            disabled={state !== 'live' || !ready || taking}
            onPress={() => void take()}
            style={{ width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', opacity: state === 'live' ? 1 : 0.35 }}>
            {({ pressed }) => <View style={{ width: 62, height: 62, borderRadius: 31, backgroundColor: '#FFFFFF', transform: [{ scale: pressed || taking ? 0.9 : 1 }] }} />}
          </Pressable>
          <View style={{ flex: 1 }} />
        </View>
      )}
    </View>
  );
}

/** A round icon button on the camera's black: the sheets' quiet fill, in the dark palette. */
function RoundButton({ c, symbol, label, value, onPress }: { c: Palette; symbol: SFSymbol; label: string; value?: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityValue={value ? { text: value } : undefined}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: c.fill, opacity: pressed ? 0.6 : 1 })}>
      <SymbolView name={symbol} size={17} weight="semibold" tintColor={c.ink} />
    </Pressable>
  );
}

/**
 * A quiet capsule on the camera's black: Capsule's quiet shape (44 points,
 * round ends, 16-point headline), drawn in the dark palette the camera's
 * chrome keeps in either appearance (Capsule itself follows the system's).
 */
function QuietCapsule({ c, title, disabled, onPress }: { c: Palette; title: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={disabled ? { disabled: true } : undefined}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 22, borderCurve: 'continuous', justifyContent: 'center', backgroundColor: c.fill, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 })}>
      <Text {...textSizing('headline')} style={[blancTextStyle(c, 'headline'), { fontSize: 16, lineHeight: 20, textAlign: 'center' }]}>
        {title}
      </Text>
    </Pressable>
  );
}

/** Retake and Use Photo: words on the black, as in iOS's camera. */
function TextButton({ c, title, strong, onPress }: { c: Palette; title: string; strong?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 44, minWidth: 88, paddingHorizontal: 12, justifyContent: 'center', alignItems: strong ? 'flex-end' : 'flex-start', opacity: pressed ? 0.5 : 1 })}>
      <Text {...textSizing('body')} numberOfLines={2} style={[blancTextStyle(c, 'body'), strong ? { fontWeight: '600' } : null]}>
        {title}
      </Text>
    </Pressable>
  );
}
