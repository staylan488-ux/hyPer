import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, Linking, Pressable, TextInput, View } from 'react-native';

import { buildClarifiedMealHint, isValidTrialReview } from '@/components/nutrition/foodTrialReview';
import { ensureFoodRow } from '@/lib/foodPersistence';
import {
  analyzeFoodTrial,
  trialFoodTotals,
  trialIngredientFood,
  trialItemFood,
  trialLogSource,
  type FoodTrialResult,
  type TrialFoodItem,
} from '@/lib/foodTrial';
import { createMealIngredient } from '@/lib/mealComposition';
import { createPendingEntryId } from '@/lib/pendingEntryId';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { FieldRow, FormNote, NumberFieldRow, ToggleRow } from '~/components/Form';
import { Label } from '~/components/Label';
import { Hairline } from '~/components/Row';
import { Section } from '~/components/Section';
import { SwipeRow } from '~/components/SwipeRow';
import { formatWhole } from '~/lib/format';
import { saveFoodEntry, workerAccessToken } from '~/lib/foodLogger';
import { haptics } from '~/lib/haptics';
import { isPreviewActive } from '~/platform/previewFlag';
import { space, type as typeScale, useBlanc } from '~/theme/blanc';

import { useLogger } from './context';
import { prepareImage, type PickedPhoto } from './PhotoTab';
import { WhenBlock } from './WhenBlock';

export type AiDraft = {
  hint: string;
  answer: string;
  photos: PickedPhoto[];
  clarificationUsed: boolean;
  result: FoodTrialResult | null;
  items: TrialFoodItem[];
  saveAsReusable: boolean;
  saveStarted: boolean;
};

export const emptyAi = (hint = ''): AiDraft => ({
  hint,
  answer: '',
  photos: [],
  clarificationUsed: false,
  result: null,
  items: [],
  saveAsReusable: false,
  saveStarted: false,
});

/** True when the AI tab holds work that a new hand-off would replace. */
export const aiHasDraft = (draft: AiDraft) => Boolean(draft.hint.trim()) || draft.photos.length > 0 || draft.result !== null;

const MAX_PHOTOS = 2;
const LIMIT = 1500;
const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * AI (Gemini, the web logger's hosted mode): describe the meal, add up to two
 * photos (a plate or a nutrition label), answer one follow-up question if
 * asked, then review each food and log it.
 */
export function AiTab({ draft, setDraft }: { draft: AiDraft; setDraft: (update: (draft: AiDraft) => AiDraft) => void }) {
  const c = useBlanc();
  const logger = useLogger();
  const [busy, setBusyState] = useState<'analysis' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  // retry-safe ids per item until its save is confirmed
  const entryIds = useRef(new WeakMap<TrialFoodItem, string>());
  const foodIds = useRef(new WeakMap<TrialFoodItem, string>());
  const pending = useRef(createPendingEntryId()).current;
  const { setBusy } = logger;
  useEffect(() => {
    setBusy(busy === 'analysis');
    return () => setBusy(false);
  }, [busy, setBusy]);

  const { result, items } = draft;
  const editing = Boolean(logger.editing);
  const valid = Boolean(result) && !result?.clarification && isValidTrialReview(items, editing);
  const frozen = busy !== null || draft.saveStarted;

  const addPhoto = () => {
    if (draft.photos.length >= MAX_PHOTOS) return;
    ActionSheetIOS.showActionSheetWithOptions({ options: ['Take photo', 'Choose from library', 'Cancel'], cancelButtonIndex: 2 }, async (index) => {
      if (index === 2) return;
      setError(null);
      try {
        if (index === 0 && !(await ImagePicker.requestCameraPermissionsAsync()).granted) {
          setError('Camera access is off. Allow Camera for hyPer in Settings, then try again.');
          return;
        }
        const options = { mediaTypes: ['images'] as ImagePicker.MediaType[], quality: 1, exif: false };
        const picked = index === 0 ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
        const asset = picked.canceled ? null : picked.assets[0];
        if (!asset) return;
        haptics.select();
        setDraft((current) =>
          current.photos.length >= MAX_PHOTOS ? current : { ...current, photos: [...current.photos, { uri: asset.uri, width: asset.width, height: asset.height }] },
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not open the camera.');
      }
    });
  };

  const analyze = async (clarify = false) => {
    if (busy || (!clarify && !draft.hint.trim() && draft.photos.length === 0)) return;
    setBusyState('analysis');
    setError(null);
    try {
      const hint = clarify ? buildClarifiedMealHint(draft.hint, result?.clarification || result?.summary || '', draft.answer) : draft.hint;
      if (clarify) setDraft((current) => ({ ...current, clarificationUsed: true }));
      const images = isPreviewActive()
        ? []
        : await Promise.all(draft.photos.map(async (photo, index) => ({ ...(await prepareImage(photo)), angle: index === 0 ? ('top' as const) : ('side' as const) })));
      const response = await analyzeFoodTrial({
        images,
        hint: isPreviewActive() && hint.trim().length < 5 ? 'Preview meal' : hint,
        accessToken: await workerAccessToken(),
        ...(clarify ? { clarificationUsed: true } : {}),
      });
      haptics.success();
      setOpen(null);
      setDraft((current) => ({ ...current, answer: '', result: response, items: response.items.map((item) => ({ ...item })) }));
    } catch (cause) {
      haptics.error();
      setError(cause instanceof Error ? cause.message : 'Could not analyze the meal.');
    } finally {
      setBusyState(null);
    }
  };

  const changeMeal = () => {
    setError(null);
    setOpen(null);
    setDraft((current) => ({ ...current, result: null, items: [], answer: '', clarificationUsed: false, saveAsReusable: false, saveStarted: false }));
  };

  const update = (index: number, patch: Partial<TrialFoodItem>) =>
    setDraft((current) => ({ ...current, items: current.items.map((item, position) => (position === index ? { ...item, ...patch } : item)) }));

  const save = async () => {
    if (busy || !valid) return;
    if (logger.purpose === 'ingredients') {
      try {
        logger.addIngredients(items.map((item) => createMealIngredient(trialIngredientFood(item), 1)));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not add ingredients.');
      }
      return;
    }
    setBusyState('save');
    setError(null);
    setDraft((current) => ({ ...current, saveStarted: true }));
    try {
      for (const item of items) {
        const entryId = entryIds.current.get(item) ?? crypto.randomUUID();
        entryIds.current.set(item, entryId);
        const foodId = foodIds.current.get(item) ?? (await ensureFoodRow(trialItemFood(item, draft.saveAsReusable)));
        if (!foodId) throw new Error(`Could not save ${item.name}.`);
        foodIds.current.set(item, foodId);
        try {
          await saveFoodEntry({
            foodId,
            servings: 1,
            source: trialLogSource(item),
            when: logger.when,
            groups: logger.groups,
            editingId: logger.editing?.id,
            pending,
            retryId: entryId,
          });
        } catch {
          throw new Error(`Could not log ${item.name}.`);
        }
        setDraft((current) => ({ ...current, items: current.items.filter((candidate) => candidate !== item) }));
      }
      haptics.success();
      if (draft.saveAsReusable) void logger.reloadSavedMeals();
      setDraft(() => emptyAi());
      logger.complete();
    } catch (cause) {
      haptics.error();
      setError(`${cause instanceof Error ? cause.message : 'Could not save the meal.'} Saved foods are removed; retry the remaining foods.`);
    } finally {
      setBusyState(null);
    }
  };

  const photoControls = (
    <Section title="Photos" note={`${draft.photos.length} of ${MAX_PHOTOS}`}>
      <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: space.inset }}>
        {draft.photos.map((photo, index) => (
          <Pressable
            key={photo.uri + index}
            accessibilityRole="button"
            accessibilityLabel={`Remove photo ${index + 1}`}
            disabled={busy !== null}
            onPress={() => {
              haptics.tap();
              setDraft((current) => ({ ...current, photos: current.photos.filter((_, position) => position !== index) }));
            }}
            style={{ width: 96, height: 96, borderRadius: 10, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: c.fill }}>
            <Image source={{ uri: photo.uri }} style={{ width: 96, height: 96 }} contentFit="cover" />
            <View style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)' }}>
              <SymbolView name="xmark" size={10} weight="bold" tintColor="#FFFFFF" />
            </View>
          </Pressable>
        ))}
        {draft.photos.length < MAX_PHOTOS ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add photo"
            disabled={busy !== null}
            onPress={() => {
              haptics.tap();
              addPhoto();
            }}
            style={({ pressed }) => ({
              width: 96,
              height: 96,
              borderRadius: 10,
              borderCurve: 'continuous',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              backgroundColor: pressed ? c.pressed : c.label,
              boxShadow: `0 0 0 0.5px ${c.labelEdge}`,
            })}>
            <SymbolView name="camera" size={20} tintColor={c.ink} />
            <BlancText variant="footnote">Add photo</BlancText>
          </Pressable>
        ) : null}
      </View>
    </Section>
  );

  // ── Describe and photos ──
  if (!result) {
    return (
      <View>
        <Section title="Your meal">
          <Label>
            <TextInput
              value={draft.hint}
              onChangeText={(text) => setDraft((current) => ({ ...current, hint: text.slice(0, LIMIT) }))}
              editable={busy === null}
              multiline
              placeholder="e.g. Six Trader Joe’s chicken tikka samosas"
              placeholderTextColor={c.upcoming}
              accessibilityLabel="Your meal"
              style={[typeScale.body, { color: c.ink, minHeight: 88, padding: 16, paddingTop: 14 }]}
            />
          </Label>
          <FormNote>Photo, text, or both. Include the amount and any added oil or sauce you know about.</FormNote>
        </Section>
        {photoControls}
        {error ? <FormNote alert>{error}</FormNote> : null}
        <View style={{ paddingHorizontal: space.gutter, marginTop: 22 }}>
          <Capsule
            title={busy === 'analysis' ? 'Analyzing…' : 'Analyze meal'}
            size="large"
            fill
            busy={busy === 'analysis'}
            disabled={!draft.hint.trim() && draft.photos.length === 0}
            onPress={() => void analyze()}
          />
        </View>
      </View>
    );
  }

  // ── One follow-up question ──
  if ((result.clarification || result.items.length === 0) && !draft.saveStarted) {
    return (
      <View>
        <View style={{ paddingHorizontal: space.gutter, marginTop: 18 }}>
          <BlancText variant="footnote" tone="graphite">
            {draft.clarificationUsed ? 'Your meal' : 'One quick detail'}
          </BlancText>
          <BlancText variant="title" style={{ marginTop: 4 }}>
            {draft.clarificationUsed
              ? busy === 'analysis'
                ? 'Making your estimate…'
                : 'We couldn’t estimate this meal yet.'
              : result.clarification || 'What is the main food in this meal?'}
          </BlancText>
        </View>
        {!draft.clarificationUsed ? (
          <View style={{ marginTop: 18 }}>
            <Label>
              <FieldRow
                label="Answer"
                wide
                value={draft.answer}
                editable={busy === null}
                onChangeText={(answer) => setDraft((current) => ({ ...current, answer }))}
                placeholder="Optional, or use an estimate"
              />
            </Label>
          </View>
        ) : null}
        {photoControls}
        <FormNote>Add a meal or nutrition label photo. Up to two photos. Remove a photo to replace it.</FormNote>
        {error ? <FormNote alert>{error}</FormNote> : null}
        <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: space.gutter, marginTop: 20 }}>
          <Capsule title="Change meal" variant="quiet" disabled={busy !== null} onPress={changeMeal} />
          <Capsule
            title={draft.clarificationUsed ? 'Retry estimate' : draft.answer.trim() || draft.photos.length ? 'Update estimate' : 'Use an estimate'}
            busy={busy === 'analysis'}
            onPress={() => void analyze(true)}
            style={{ flex: 1, alignSelf: 'stretch' }}
          />
        </View>
      </View>
    );
  }

  // ── Review ──
  const totals = items.reduce(
    (sum, item) => {
      const each = trialFoodTotals(item);
      return { calories: sum.calories + each.calories, protein: sum.protein + each.protein, carbs: sum.carbs + each.carbs, fat: sum.fat + each.fat };
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );

  return (
    <View>
      <View style={{ paddingHorizontal: space.gutter, marginTop: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <BlancText variant="figure" size={56}>
            {formatWhole(totals.calories)}
          </BlancText>
          <BlancText variant="secondary" tone="graphite">
            kcal
          </BlancText>
        </View>
        <BlancText variant="secondary" tone="graphite">
          P {round1(totals.protein)} g · C {round1(totals.carbs)} g · F {round1(totals.fat)} g
        </BlancText>
        {result.summary ? (
          <BlancText variant="footnote" tone="graphite" style={{ marginTop: 8 }}>
            {result.summary}
          </BlancText>
        ) : null}
      </View>
      {editing && items.length > 1 ? <FormNote>Keep one food to replace this entry. Add other foods separately.</FormNote> : null}

      <View style={{ marginTop: 18 }}>
        <Label>
          {items.map((item, index) => {
            const each = trialFoodTotals(item);
            const expanded = open === index;
            return (
              <View key={index}>
                {index > 0 ? <Hairline /> : null}
                <SwipeRow
                  name={item.name}
                  actions={
                    frozen
                      ? []
                      : [
                          {
                            label: 'Remove',
                            destructive: true,
                            onPress: () => {
                              setOpen(null);
                              setDraft((current) => ({ ...current, items: current.items.filter((_, position) => position !== index) }));
                            },
                          },
                        ]
                  }>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name}, ${round1(each.calories)} kcal. ${expanded ? 'Close' : 'Adjust'}`}
                  onPress={() => {
                    haptics.tap();
                    setOpen(expanded ? null : index);
                  }}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 10, paddingLeft: 18, paddingRight: 16, backgroundColor: pressed ? c.pressed : c.label })}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <BlancText variant="bodyStrong" numberOfLines={1}>
                      {item.name}
                    </BlancText>
                    <BlancText variant="secondary" tone="graphite" numberOfLines={1} style={{ marginTop: 1 }}>
                      {item.quantity} {item.unit} · {item.evidence === 'label' ? 'Label-based' : 'Estimated'} · P {round1(each.protein)} g
                    </BlancText>
                  </View>
                  <BlancText variant="secondary" tone="graphite" style={{ fontVariant: ['tabular-nums'] }}>
                    {formatWhole(each.calories)}
                  </BlancText>
                  <SymbolView name={expanded ? 'chevron.up' : 'chevron.down'} size={12} weight="semibold" tintColor={c.upcoming} />
                </Pressable>
                </SwipeRow>
                {expanded ? (
                  <View style={{ paddingBottom: 12 }}>
                    <Hairline />
                    <FieldRow label="Food name" wide value={item.name} editable={!frozen} onChangeText={(name) => update(index, { name })} />
                    <Hairline />
                    <NumberFieldRow
                      label="Amount eaten"
                      value={item.quantity}
                      editable={!frozen}
                      onChangeValue={(quantity) => update(index, { quantity, amountConfirmed: true })}
                    />
                    <Hairline />
                    <FieldRow label="Unit" value={item.unit} editable={!frozen} onChangeText={(unit) => update(index, { unit, amountConfirmed: true })} />
                    <Hairline />
                    <NumberFieldRow
                      label="Nutrition per"
                      unit={item.unit || 'units'}
                      value={item.basisQuantity}
                      editable={!frozen}
                      onChangeValue={(basisQuantity) => update(index, { basisQuantity })}
                    />
                    {(['calories', 'protein', 'carbs', 'fat'] as const).map((key) => (
                      <View key={key}>
                        <Hairline />
                        <NumberFieldRow
                          label={key[0].toUpperCase() + key.slice(1)}
                          unit={key === 'calories' ? 'kcal' : 'g'}
                          value={item[key]}
                          editable={!frozen}
                          onChangeValue={(amount) => update(index, { [key]: amount })}
                        />
                      </View>
                    ))}
                    <BlancText variant="footnote" tone="graphite" style={{ marginHorizontal: 18, marginTop: 8 }}>
                      Nutrition is per {item.basisQuantity} {item.unit}; the total scales with the amount eaten.{item.notes ? ` ${item.notes}` : ''}
                    </BlancText>
                    <View style={{ paddingHorizontal: 18, marginTop: 10 }}>
                      <Capsule
                        title="Remove food"
                        variant="quiet"
                        disabled={frozen}
                        onPress={() => {
                          setOpen(null);
                          setDraft((current) => ({ ...current, items: current.items.filter((_, position) => position !== index) }));
                        }}
                      />
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })}
        </Label>
      </View>

      {result.sources.length > 0 ? (
        <Section title="Sources" note={String(result.sources.length)}>
          <Label>
            {result.sources.map((source, index) => (
              <View key={source.url}>
                {index > 0 ? <Hairline /> : null}
                <Pressable
                  accessibilityRole="link"
                  onPress={() => void Linking.openURL(source.url)}
                  style={({ pressed }) => ({ paddingVertical: 12, paddingHorizontal: 18, backgroundColor: pressed ? c.pressed : 'transparent' })}>
                  <BlancText variant="secondary" numberOfLines={2}>
                    {source.title}
                  </BlancText>
                </Pressable>
              </View>
            ))}
          </Label>
        </Section>
      ) : null}

      <WhenBlock disabled={frozen} />

      {logger.purpose === 'log' ? (
        <View style={{ marginTop: 18 }}>
          <Label>
            <ToggleRow
              label="Save as reusable meal"
              detail={items.length > 1 ? 'Also add these foods to Saved meals.' : 'Also add this food to Saved meals.'}
              value={draft.saveAsReusable}
              disabled={frozen}
              onChange={(saveAsReusable) => setDraft((current) => ({ ...current, saveAsReusable }))}
            />
          </Label>
        </View>
      ) : null}

      {error ? <FormNote alert>{error}</FormNote> : null}
      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: space.gutter, marginTop: 20 }}>
        <Capsule title="Change meal" variant="quiet" disabled={frozen} onPress={changeMeal} />
        <Capsule
          title={logger.purpose === 'ingredients' ? 'Add ingredients' : editing ? 'Save changes' : 'Log meal'}
          busy={busy === 'save'}
          disabled={!valid || busy !== null}
          onPress={() => void save()}
          style={{ flex: 1, alignSelf: 'stretch' }}
        />
      </View>
    </View>
  );
}
