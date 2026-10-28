import { Image } from 'expo-image';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Pressable, Image as RNImage, TextInput, View } from 'react-native';

import { ensureFoodRow } from '@/lib/foodPersistence';
import { formatMeasurementAmount } from '@/lib/foodUnits';
import { createMealIngredient } from '@/lib/mealComposition';
import { createPendingEntryId } from '@/lib/pendingEntryId';
import { analyzeFoodPhoto, getPhotoWorkerSettings, type PhotoAnalysisAngle, type PhotoAnalysisProvider } from '@/lib/photoAnalysis';
import {
  buildPhotoHint,
  COMBINE_MEAL_KEY,
  groundPhotoItems,
  logPhotoItems,
  MAX_ANALYSIS_DATA_URL_CHARS,
  MAX_ANALYSIS_IMAGE_DIMENSION,
  MIN_ANALYSIS_JPEG_QUALITY,
  photoItemsInvalid,
  photoItemStatus,
  photoItemTotals,
  providerFallbackNote,
  providerName,
  type PhotoReviewItem,
} from '@/lib/photoReview';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { FieldRow, FormNote, ToggleRow, useDecimalText } from '~/components/Form';
import { Label } from '~/components/Label';
import { Hairline } from '~/components/Row';
import { Section } from '~/components/Section';
import { formatWhole } from '~/lib/format';
import { saveFoodEntry, workerAccessToken } from '~/lib/foodLogger';
import { haptics } from '~/lib/haptics';
import { isPreviewActive } from '~/platform/previewFlag';
import { space, type as typeScale, useBlanc } from '~/theme/blanc';

import { useLogger } from './context';
import { WhenBlock } from './WhenBlock';

export type PickedPhoto = { uri: string; width: number; height: number };

export type PhotoDraft = {
  photos: Partial<Record<PhotoAnalysisAngle, PickedPhoto>>;
  plate: string;
  oils: string;
  details: string;
  items: PhotoReviewItem[];
  provider: PhotoAnalysisProvider;
  model: string;
  summary: string;
};

export const emptyPhoto = (): PhotoDraft => ({
  photos: {},
  plate: '',
  oils: '',
  details: '',
  items: [],
  provider: getPhotoWorkerSettings().provider,
  model: '',
  summary: '',
});

/** Re-encodes a photo as JPEG at most 2576 px on its long edge, within the worker's size budget. */
export async function prepareImage(photo: PickedPhoto): Promise<{ imageBase64: string; mimeType: string }> {
  const scale = Math.min(1, MAX_ANALYSIS_IMAGE_DIMENSION / Math.max(photo.width || 1, photo.height || 1));
  const actions = scale < 1 ? [{ resize: { width: Math.max(1, Math.round(photo.width * scale)) } }] : [];
  let quality = 0.82;
  for (;;) {
    const result = await manipulateAsync(photo.uri, actions, { compress: quality, format: SaveFormat.JPEG, base64: true });
    const base64 = result.base64 ?? '';
    if (!base64) throw new Error('Invalid image format');
    if ('data:image/jpeg;base64,'.length + base64.length <= MAX_ANALYSIS_DATA_URL_CHARS) return { imageBase64: base64, mimeType: 'image/jpeg' };
    if (quality <= MIN_ANALYSIS_JPEG_QUALITY) throw new Error('Image is too large for analysis. Try a closer crop.');
    quality -= 0.08;
  }
}

function readCombinePreference(): boolean {
  try {
    const stored = globalThis.localStorage?.getItem(COMBINE_MEAL_KEY);
    return stored == null ? true : stored === '1';
  } catch {
    return true;
  }
}

/** Photo: one or two photos of the plate, analyzed by the food worker, then reviewed item by item. */
export function PhotoTab({ draft, setDraft }: { draft: PhotoDraft; setDraft: (update: (draft: PhotoDraft) => PhotoDraft) => void }) {
  const logger = useLogger();
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setBusy } = logger;
  useEffect(() => {
    setBusy(analyzing);
    return () => setBusy(false);
  }, [analyzing, setBusy]);

  const pick = (angle: PhotoAnalysisAngle) => {
    const options = ['Take photo', 'Choose from library', ...(draft.photos[angle] ? ['Remove photo'] : []), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions(
      { options, cancelButtonIndex: options.length - 1, destructiveButtonIndex: draft.photos[angle] ? 2 : undefined },
      async (index) => {
        if (index === options.length - 1) return;
        setError(null);
        if (index === 2) {
          setDraft((current) => {
            const photos = { ...current.photos };
            delete photos[angle];
            return { ...current, photos };
          });
          return;
        }
        try {
          if (index === 0) {
            const permission = await ImagePicker.requestCameraPermissionsAsync();
            if (!permission.granted) {
              setError('Camera access is off. Allow Camera for hyPer in Settings, then try again.');
              return;
            }
          }
          const options = { mediaTypes: ['images'] as ImagePicker.MediaType[], quality: 1, exif: false };
          const result = index === 0 ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
          const asset = result.canceled ? null : result.assets[0];
          if (!asset) return;
          if (asset.type && asset.type !== 'image') {
            setError('Please choose an image file.');
            return;
          }
          haptics.select();
          setDraft((current) => ({ ...current, photos: { ...current.photos, [angle]: { uri: asset.uri, width: asset.width, height: asset.height } } }));
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Could not open the camera.');
        }
      },
    );
  };

  const usePreviewPlate = () => {
    const source = RNImage.resolveAssetSource(require('../../assets/images/icon.png'));
    if (!source) return;
    setDraft((current) => ({ ...current, photos: { top: { uri: source.uri, width: source.width ?? 1024, height: source.height ?? 1024 } } }));
  };

  const analyze = async () => {
    if ((!draft.photos.top && !draft.photos.side) || analyzing) return;
    setAnalyzing(true);
    setError(null);
    try {
      const entries = (['top', 'side'] as const).flatMap((angle) => (draft.photos[angle] ? [{ angle, photo: draft.photos[angle]! }] : []));
      // preview answers from a fixture and never reads the images
      const images = isPreviewActive()
        ? entries.map(({ angle }) => ({ angle, imageBase64: '', mimeType: 'image/jpeg' }))
        : await Promise.all(entries.map(async ({ angle, photo }) => ({ angle, ...(await prepareImage(photo)) })));
      const settings = getPhotoWorkerSettings();
      const result = await analyzeFoodPhoto({
        images,
        hint: buildPhotoHint({ plateDiameter: draft.plate, ingredients: draft.oils, details: draft.details }),
        accessToken: await workerAccessToken(),
        settings,
      });
      const items = await groundPhotoItems(result.items);
      haptics.success();
      setDraft((current) => ({
        ...current,
        items,
        provider: result.provider,
        model: result.model,
        summary: `${providerFallbackNote(settings.provider, result.provider, 'analyzed this photo')}${result.summary}`,
      }));
    } catch (cause) {
      haptics.error();
      setError(cause instanceof Error ? cause.message : 'Could not analyze photo.');
    } finally {
      setAnalyzing(false);
    }
  };

  if (draft.items.length > 0) return <PhotoReview draft={draft} setDraft={setDraft} />;

  return (
    <View>
      <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 16 }}>
        Add at least one photo of your meal. A top-down shot estimates portions best, but any angle works — add both for the most accuracy.
      </BlancText>

      <Section title="Photos">
        <Label>
          <PhotoSlot title="Top view" detail="Shows every component and how much of the plate it covers." photo={draft.photos.top} busy={analyzing} onPress={() => pick('top')} />
          <Hairline />
          <PhotoSlot title="45° side view" detail="Adds height and depth, which improves portion estimates." photo={draft.photos.side} busy={analyzing} onPress={() => pick('side')} />
        </Label>
        {isPreviewActive() && !draft.photos.top ? (
          <View style={{ paddingHorizontal: space.gutter, marginTop: 12 }}>
            <Capsule title="Use preview plate" variant="quiet" onPress={usePreviewPlate} />
          </View>
        ) : null}
      </Section>

      <Section title="Details" note="optional">
        <Label>
          <FieldRow label="Plate diameter" unit="cm" value={draft.plate} onChangeText={(plate) => setDraft((current) => ({ ...current, plate }))} keyboardType="decimal-pad" placeholder="27" editable={!analyzing} />
          <Hairline />
          <FieldRow label="Oils, sauces" wide value={draft.oils} onChangeText={(oils) => setDraft((current) => ({ ...current, oils }))} placeholder="e.g. 1 tbsp olive oil" editable={!analyzing} />
          <Hairline />
          <FieldRow label="Other details" wide value={draft.details} onChangeText={(details) => setDraft((current) => ({ ...current, details }))} placeholder="e.g. skin removed" editable={!analyzing} />
        </Label>
      </Section>

      {error ? <FormNote alert>{error}</FormNote> : null}
      <View style={{ paddingHorizontal: space.gutter, marginTop: 20 }}>
        <Capsule
          title={analyzing ? 'Reading the plate…' : 'Analyze'}
          size="large"
          fill
          busy={analyzing}
          disabled={!draft.photos.top && !draft.photos.side}
          onPress={() => void analyze()}
        />
      </View>
    </View>
  );
}

function PhotoSlot({ title, detail, photo, busy, onPress }: { title: string; detail: string; photo?: PickedPhoto; busy: boolean; onPress: () => void }) {
  const c = useBlanc();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={photo ? `${title}, photo added. Change` : `Add ${title.toLowerCase()} photo`}
      disabled={busy}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, paddingLeft: 18, backgroundColor: pressed ? c.pressed : 'transparent' })}>
      <View style={{ width: 64, height: 64, borderRadius: 8, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' }}>
        {photo ? <Image source={{ uri: photo.uri }} style={{ width: 64, height: 64 }} contentFit="cover" /> : <SymbolView name="camera" size={20} tintColor={c.graphite} />}
        {photo && busy ? (
          <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' }}>
            <ActivityIndicator color="#FFFFFF" />
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1 }}>
        <BlancText variant="bodyStrong">{title}</BlancText>
        <BlancText variant="footnote" tone="graphite" style={{ marginTop: 2 }}>
          {photo ? 'Tap to retake or remove' : detail}
        </BlancText>
      </View>
    </Pressable>
  );
}

/** Every component with its grams and source, then log the plate. */
function PhotoReview({ draft, setDraft }: { draft: PhotoDraft; setDraft: (update: (draft: PhotoDraft) => PhotoDraft) => void }) {
  const c = useBlanc();
  const logger = useLogger();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [combine, setCombine] = useState(readCombinePreference);
  const pending = useRef(createPendingEntryId()).current;
  const items = draft.items;
  const total = Math.round(items.reduce((sum, item) => sum + photoItemTotals(item).calories, 0));

  const updateItem = (id: string, patch: Partial<PhotoReviewItem>) =>
    setDraft((current) => ({ ...current, items: current.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) }));

  const chooseSource = (item: PhotoReviewItem) => {
    const labels = [
      `Keep model estimate (${Math.round(item.confidence * 100)}% visual confidence)`,
      ...item.groundingCandidates.map(
        (food) => `${food.name} · ${Math.round(food.calories)} kcal per ${food.serving_label || `${formatMeasurementAmount(food.serving_size || 100)} ${food.serving_unit || 'g'}`}`,
      ),
      'Cancel',
    ];
    ActionSheetIOS.showActionSheetWithOptions({ title: `Match ${item.name}`, options: labels, cancelButtonIndex: labels.length - 1 }, (index) => {
      if (index === labels.length - 1) return;
      haptics.select();
      updateItem(item.id, { groundedFood: index === 0 ? null : item.groundingCandidates[index - 1], persistedFoodId: undefined });
    });
  };

  const retake = () => {
    if (saving) return;
    setDraft(() => emptyPhoto());
  };

  const save = async () => {
    if (items.length === 0 || saving) return;
    if (photoItemsInvalid(items)) {
      setError('Every photo item needs a name and an amount greater than zero.');
      return;
    }
    if (logger.purpose === 'ingredients') {
      try {
        logger.addIngredients(
          items.map((item) =>
            createMealIngredient(
              item.groundedFood || {
                id: `photo-${item.id}`,
                user_id: null,
                name: item.name.trim(),
                ...photoItemTotals(item),
                serving_size: item.amountGrams,
                serving_unit: 'g',
                source: 'manual_entry',
                fdc_id: null,
              },
              item.groundedFood ? item.amountGrams / Math.max(1, item.groundedFood.serving_size || 100) : 1,
            ),
          ),
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not add ingredients.');
      }
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await logPhotoItems({
        items,
        combine,
        summary: draft.summary,
        provider: draft.provider,
        ensureFood: ensureFoodRow,
        saveEntry: async (foodId, servings, source) => {
          try {
            await saveFoodEntry({ foodId, servings, source, when: logger.when, groups: logger.groups, editingId: logger.editing?.id, pending });
            return true;
          } catch {
            return false;
          }
        },
        onFoodPersisted: (itemId, foodId) => updateItem(itemId, { persistedFoodId: foodId }),
        onItemLogged: (itemId) => setDraft((current) => ({ ...current, items: current.items.filter((item) => item.id !== itemId) })),
      });
      haptics.success();
      setDraft(() => emptyPhoto());
      logger.complete();
    } catch (cause) {
      haptics.error();
      setError(cause instanceof Error ? cause.message : 'Could not save the photo items.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View>
      <View style={{ paddingHorizontal: space.gutter, marginTop: 12 }}>
        <BlancText variant="footnote" tone="graphite">
          {providerName(draft.provider)}
          {draft.model ? ` · ${draft.model}` : ''}
        </BlancText>
        <BlancText variant="title" style={{ marginTop: 2 }}>
          {items.length} food{items.length === 1 ? '' : 's'} found
        </BlancText>
        {draft.summary ? (
          <BlancText variant="secondary" tone="graphite" style={{ marginTop: 6 }}>
            {draft.summary}
          </BlancText>
        ) : null}
        <BlancText variant="footnote" tone="graphite" style={{ marginTop: 6 }}>
          Review every component and portion. USDA suggestions are never applied until you choose one.
        </BlancText>
      </View>

      <View style={{ marginTop: 18 }}>
        <Label>
          {items.map((item, index) => {
            const totals = photoItemTotals(item);
            return (
              <View key={item.id}>
                {index > 0 ? <Hairline /> : null}
                <View style={{ paddingVertical: 12, paddingLeft: 18, paddingRight: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <TextInput
                      value={item.name}
                      onChangeText={(name) => updateItem(item.id, { name, groundedFood: null, persistedFoodId: undefined })}
                      accessibilityLabel="Food"
                      style={[typeScale.bodyStrong, { flex: 1, color: c.ink, padding: 0, minHeight: 36 }]}
                    />
                    <GramsInput
                      grams={item.amountGrams}
                      label={`Grams of ${item.name}`}
                      onChange={(amountGrams) => updateItem(item.id, { amountGrams, persistedFoodId: undefined })}
                    />
                    <BlancText variant="body" tone="graphite">
                      g
                    </BlancText>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${item.name}`}
                      hitSlop={6}
                      onPress={() => {
                        haptics.tap();
                        setDraft((current) => ({ ...current, items: current.items.filter((candidate) => candidate.id !== item.id) }));
                      }}
                      style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
                      <SymbolView name="xmark" size={13} weight="semibold" tintColor={c.graphite} />
                    </Pressable>
                  </View>
                  <BlancText variant="meta" style={{ marginTop: 4 }}>
                    {Math.round(totals.calories)} kcal · P {Math.round(totals.protein)} · C {Math.round(totals.carbs)} · F {Math.round(totals.fat)}
                  </BlancText>
                  <BlancText variant="footnote" tone="graphite" style={{ marginTop: 2, paddingRight: 10 }}>
                    {photoItemStatus(item)}
                    {item.notes ? ` · ${item.notes}` : ''}
                  </BlancText>
                  {item.groundingCandidates.length > 0 ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        haptics.tap();
                        chooseSource(item);
                      }}
                      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, opacity: pressed ? 0.5 : 1, minHeight: 32 })}>
                      <BlancText variant="footnote" weight="600">
                        Nutrition source: {item.groundedFood ? item.groundedFood.name : 'model estimate'}
                      </BlancText>
                      <SymbolView name="chevron.up.chevron.down" size={10} weight="semibold" tintColor={c.ink} />
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}
        </Label>
      </View>

      {logger.purpose === 'log' && items.length > 1 ? (
        <View style={{ marginTop: 18 }}>
          <Label>
            <ToggleRow
              label="Log as one meal"
              detail={combine ? `Combines all ${items.length} components into a single entry, with the description above attached.` : `Logs all ${items.length} components as separate entries.`}
              value={combine}
              onChange={(next) => {
                setCombine(next);
                try {
                  globalThis.localStorage?.setItem(COMBINE_MEAL_KEY, next ? '1' : '0');
                } catch {
                  // a preference that cannot be kept is still used for this plate
                }
              }}
            />
          </Label>
        </View>
      ) : null}

      <WhenBlock disabled={saving} />

      <View style={{ paddingHorizontal: space.gutter, marginTop: 28, flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
        <BlancText variant="figure" size={44}>
          {formatWhole(total)}
        </BlancText>
        <BlancText variant="secondary" tone="graphite">
          kcal plate total
        </BlancText>
      </View>

      {error ? <FormNote alert>{error}</FormNote> : null}
      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: space.gutter, marginTop: 20 }}>
        <Capsule
          title="Retake"
          variant="quiet"
          disabled={saving}
          onPress={() =>
            Alert.alert('Discard this estimate?', 'The photos and the review are cleared.', [
              { text: 'Keep', style: 'cancel' },
              { text: 'Discard', style: 'destructive', onPress: retake },
            ])
          }
        />
        <Capsule
          title={
            logger.purpose === 'ingredients'
              ? 'Add ingredients'
              : combine && items.length > 1
                ? 'Log 1 meal'
                : `Log ${items.length} item${items.length === 1 ? '' : 's'}`
          }
          busy={saving}
          disabled={items.length === 0}
          onPress={() => void save()}
          style={{ flex: 1, alignSelf: 'stretch' }}
        />
      </View>
    </View>
  );
}

/** An item's grams; keeps "1." while typing (see useDecimalText). */
function GramsInput({ grams, label, onChange }: { grams: number; label: string; onChange: (grams: number) => void }) {
  const c = useBlanc();
  const { text, onChangeText } = useDecimalText(grams, (value) => onChange(Math.max(0, value)));
  return (
    <TextInput
      value={text}
      onChangeText={onChangeText}
      keyboardType="decimal-pad"
      accessibilityLabel={label}
      selectTextOnFocus
      style={[typeScale.body, { color: c.ink, padding: 0, minWidth: 52, minHeight: 36, textAlign: 'right', fontVariant: ['tabular-nums'] }]}
    />
  );
}
