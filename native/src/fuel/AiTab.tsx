import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useEffect, useEffectEvent, useRef, useState, type ComponentRef } from 'react';
import { Alert, Keyboard, Linking, Pressable, TextInput, View } from 'react-native';
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated';

import { advanceTrail, startTrail, type AnalysisTrail } from '@/lib/analysisProgress';
import { buildClarifiedMealHint, isValidTrialReview } from '@/lib/foodTrialReview';
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
import { FieldArea, FieldRow, FormNote, NumberFieldRow, ToggleRow } from '~/components/Form';
import { Label } from '~/components/Label';
import { HoldMenu, hasHoldMenu, showActionSheet, type MenuAction } from '~/components/HoldMenu';
import { RollingText } from '~/components/RollingText';
import { Hairline } from '~/components/Row';
import { Section } from '~/components/Section';
import { closeOpenSwipeRow, SwipeRow } from '~/components/SwipeRow';
import { announce, speak, useLargeText } from '~/lib/accessibility';
import { formatWhole } from '~/lib/format';
import { saveFoodEntry, workerAccessToken } from '~/lib/foodLogger';
import { haptics } from '~/lib/haptics';
import { figureLayout, rowEnter, rowExit, rowLayout } from '~/lib/motion';
import { isPreviewActive } from '~/platform/previewFlag';
import { space, type as typeScale, useBlanc } from '~/theme/blanc';

import { AnalysisProgress } from './AnalysisProgress';
import { useLogger } from './context';
import { CAMERA_OFF, dropPhotoChoices, foodPickerUp, pickFoodPhoto, prepareImage, showPhotoChoices, type PickedPhoto } from './PhotoTab';
import { WhenBlock } from './WhenBlock';

/** A food from the estimate, with a key that stays with it while foods are removed. */
export type AiItem = TrialFoodItem & { key: string };

export type AiDraft = {
  hint: string;
  answer: string;
  photos: PickedPhoto[];
  clarificationUsed: boolean;
  result: FoodTrialResult | null;
  items: AiItem[];
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
/** The AI tab can take a photo now: no estimate yet and room for one more (Snap a meal). */
export const aiTakesPhoto = (draft: AiDraft) => draft.result === null && !draft.saveStarted && draft.photos.length < MAX_PHOTOS;
const LIMIT = 1500;
const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * AI (Gemini, the hosted mode): describe the meal, add up to two photos (a
 * plate or a nutrition label), answer one follow-up question if asked, then
 * review each food and log it.
 */
export function AiTab({ draft, setDraft, cameraRequest = 0, addPhotoRequest = 0, focusRequest = 0 }: {
  draft: AiDraft;
  setDraft: (update: (draft: AiDraft) => AiDraft) => void;
  /** Snap a meal: each new value opens the camera, then analyzes the photo (log-food.tsx). */
  cameraRequest?: number;
  /** Log food's Photo button: each new value opens the camera and adds what it takes, with nothing estimated until Analyze meal. */
  addPhotoRequest?: number;
  /** Log food's Describe button: each new value puts the cursor in Your meal. */
  focusRequest?: number;
}) {
  const c = useBlanc();
  const large = useLargeText();
  const logger = useLogger();
  const [busy, setBusyState] = useState<'analysis' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // What the analysis is doing, step by step, and when Analyze was tapped.
  const [trail, setTrail] = useState<{ steps: AnalysisTrail; startedAt: number } | null>(null);
  // the food opened for adjusting, by its key
  const [open, setOpen] = useState<string | null>(null);
  // retry-safe ids per food (by its key) until its save is confirmed
  const entryIds = useRef(new Map<string, string>());
  const foodIds = useRef(new Map<string, string>());
  const pending = useRef(createPendingEntryId()).current;
  const { beginBusy } = logger;
  // Claims the sheet only while this tab's own lookup runs.
  useEffect(() => {
    if (busy !== 'analysis') return;
    return beginBusy();
  }, [busy, beginBusy]);
  // A capture that starts over (an ingredient added to a meal) remounts this
  // tab with an empty draft: an analysis still running then lands nowhere.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      // closed under a photo's menu: it never answers, so Snap a meal stops waiting for it
      dropPhotoChoices();
    };
  }, []);

  const { result, items } = draft;
  const editing = Boolean(logger.editing);
  const valid = Boolean(result) && !result?.clarification && isValidTrialReview(items, editing);
  const frozen = busy !== null || draft.saveStarted;

  // The camera at once, with the photo library a tap away on its screen.
  const addPhoto = async () => {
    if (draft.photos.length >= MAX_PHOTOS) return;
    setError(null);
    try {
      const photo = await pickFoodPhoto('camera');
      if (!photo || !live.current) return;
      haptics.select();
      setDraft((current) => (current.photos.length >= MAX_PHOTOS ? current : { ...current, photos: [...current.photos, photo] }));
    } catch (cause) {
      if (live.current) setError(cause instanceof Error ? cause.message : 'Could not open the camera.');
    }
  };

  // Snap a meal passes the photos it just added; every other call uses the draft's.
  const analyze = async ({ clarify = false, photos = draft.photos }: { clarify?: boolean; photos?: PickedPhoto[] } = {}) => {
    if (busy || (!clarify && !draft.hint.trim() && photos.length === 0)) return;
    setBusyState('analysis');
    setError(null);
    // The steps show where the button was; the keyboard would cover them.
    Keyboard.dismiss();
    const meal = { photos: photos.length, hint: draft.hint };
    setTrail({ steps: startTrail(meal), startedAt: Date.now() });
    try {
      const hint = clarify ? buildClarifiedMealHint(draft.hint, result?.clarification || result?.summary || '', draft.answer) : draft.hint;
      if (clarify) setDraft((current) => ({ ...current, clarificationUsed: true }));
      const images = isPreviewActive()
        ? []
        : await Promise.all(photos.map(async (photo, index) => ({ ...(await prepareImage(photo)), angle: index === 0 ? ('top' as const) : ('side' as const) })));
      const response = await analyzeFoodTrial({
        images,
        hint: isPreviewActive() && hint.trim().length < 5 ? 'Preview meal' : hint,
        accessToken: await workerAccessToken(),
        ...(clarify ? { clarificationUsed: true } : {}),
        onProgress: (step) => {
          if (live.current) setTrail((current) => current && { ...current, steps: advanceTrail(current.steps, step, meal) });
        },
      });
      if (!live.current) return;
      haptics.success();
      setOpen(null);
      setDraft((current) => ({ ...current, answer: '', result: response, items: response.items.map((item) => ({ ...item, key: crypto.randomUUID() })) }));
      // The answer replaces the button VoiceOver was on: say what came back,
      // the follow-up question or the estimate (as the screen titles it).
      const kcal = response.items.reduce((sum, item) => sum + trialFoodTotals(item).calories, 0);
      announce(
        response.clarification || response.items.length === 0
          ? clarify
            ? 'We couldn’t estimate this meal yet.'
            : response.clarification || 'What is the main food in this meal?'
          : `Estimate ready · ${response.items.length} food${response.items.length === 1 ? '' : 's'} · ${formatWhole(kcal)} kcal`,
      );
    } catch (cause) {
      if (!live.current) return;
      haptics.error();
      setError(cause instanceof Error ? cause.message : 'Could not analyze the meal.');
    } finally {
      setBusyState(null);
      setTrail(null);
    }
  };

  // Snap a meal (log-food.tsx asks once the sheet is up): the camera at once,
  // then the analysis without a tap. Cancelling leaves the tab as it was.
  const seenCamera = useRef(cameraRequest);
  const snap = useEffectEvent(async () => {
    if (busy !== null || foodPickerUp() || !aiTakesPhoto(draft)) return;
    setError(null);
    try {
      const photo = await pickFoodPhoto('camera');
      if (!photo || !live.current) return;
      haptics.select();
      const photos = [...draft.photos, photo];
      setDraft((current) => (current.photos.length >= MAX_PHOTOS ? current : { ...current, photos: [...current.photos, photo] }));
      announce('Analyzing meal');
      void analyze({ photos });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open the camera.');
    }
  });
  useEffect(() => {
    if (cameraRequest === seenCamera.current) return;
    seenCamera.current = cameraRequest;
    void snap();
  }, [cameraRequest]);

  // Photo and Describe are two doors into this one view: Photo adds a photo
  // (the words can follow), Describe starts with the words (a photo can
  // follow). Neither runs the estimate; Analyze meal does.
  const seenAddPhoto = useRef(addPhotoRequest);
  const addPhotoNow = useEffectEvent(() => {
    if (busy !== null || foodPickerUp() || !aiTakesPhoto(draft)) return;
    void addPhoto();
  });
  useEffect(() => {
    if (addPhotoRequest === seenAddPhoto.current) return;
    seenAddPhoto.current = addPhotoRequest;
    addPhotoNow();
  }, [addPhotoRequest]);
  const hintField = useRef<ComponentRef<typeof TextInput>>(null);
  const seenFocus = useRef(focusRequest);
  useEffect(() => {
    if (focusRequest === seenFocus.current) return;
    seenFocus.current = focusRequest;
    // after the tab switch has drawn the field
    const timer = setTimeout(() => hintField.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [focusRequest]);

  const clearEstimate = () => {
    setError(null);
    setOpen(null);
    setDraft((current) => ({ ...current, result: null, items: [], answer: '', clarificationUsed: false, saveAsReusable: false, saveStarted: false }));
  };
  // An estimate (or a typed answer) is work: going back to the meal asks first.
  const changeMeal = () => {
    if (!result || (items.length === 0 && !draft.answer.trim())) {
      clearEstimate();
      return;
    }
    Alert.alert('Discard this estimate?', 'The analysis and your changes are cleared.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: clearEstimate },
    ]);
  };

  const update = (key: string, patch: Partial<TrialFoodItem>) =>
    setDraft((current) => ({ ...current, items: current.items.map((item) => (item.key === key ? { ...item, ...patch } : item)) }));

  const removeItem = (key: string) => {
    haptics.success();
    setOpen((current) => (current === key ? null : current));
    setDraft((current) => ({ ...current, items: current.items.filter((item) => item.key !== key) }));
  };

  const itemMenu = (item: AiItem): MenuAction[] => {
    const expanded = open === item.key;
    return [
      { title: expanded ? 'Close' : 'Adjust', symbol: expanded ? 'chevron.up' : 'slider.horizontal.3', run: () => setOpen(expanded ? null : item.key) },
      { title: 'Remove', symbol: 'trash', destructive: true, removes: true, run: () => removeItem(item.key) },
    ];
  };

  const removePhoto = (photo: PickedPhoto) => {
    haptics.success();
    setDraft((current) => ({ ...current, photos: current.photos.filter((candidate) => candidate !== photo) }));
  };
  const photoMenu = (photo: PickedPhoto, index: number) =>
    showPhotoChoices(
      { title: `Photo ${index + 1}`, options: ['Remove photo', 'Cancel'], cancelButtonIndex: 1, destructiveButtonIndex: 0 },
      (choice) => {
        if (choice === 0) removePhoto(photo);
      },
    );

  const save = async () => {
    if (busy || !valid) return;
    if (logger.purpose === 'ingredients') {
      try {
        logger.addIngredients(items.map((item) => createMealIngredient(trialIngredientFood(item), 1)));
      } catch (cause) {
        haptics.error();
        setError(cause instanceof Error ? cause.message : 'Could not add ingredients.');
      }
      return;
    }
    setBusyState('save');
    setError(null);
    setDraft((current) => ({ ...current, saveStarted: true }));
    const release = logger.beginSave();
    try {
      for (const item of items) {
        const entryId = entryIds.current.get(item.key) ?? crypto.randomUUID();
        entryIds.current.set(item.key, entryId);
        const foodId = foodIds.current.get(item.key) ?? (await ensureFoodRow(trialItemFood(item, draft.saveAsReusable)));
        if (!foodId) throw new Error(`Could not save ${item.name}.`);
        foodIds.current.set(item.key, foodId);
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
        setDraft((current) => ({ ...current, items: current.items.filter((candidate) => candidate.key !== item.key) }));
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
      release();
    }
  };

  const photoControls = (
    <Section title="Photos">
      <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: space.inset, ...(large ? { flexWrap: 'wrap' } : null) }}>
        {draft.photos.map((photo, index) => (
          // A hold lifts the photo with Remove beside it, as in Photos.
          <HoldMenu
            key={photo.uri + index}
            enabled={busy === null}
            actions={[{ title: 'Remove photo', symbol: 'trash', destructive: true, removes: true, run: () => removePhoto(photo) }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Meal photo ${index + 1}`}
            accessibilityHint="Offers to remove it"
            accessibilityState={busy !== null ? { disabled: true } : undefined}
            // the hold's Remove photo, straight away
            accessibilityActions={busy === null ? [{ name: 'remove', label: 'Remove photo' }] : undefined}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'remove') removePhoto(photo);
            }}
            disabled={busy !== null}
            onPress={() => {
              haptics.tap();
              photoMenu(photo, index);
            }}
            style={({ pressed }) => ({
              width: 96,
              height: 96,
              borderRadius: 10,
              borderCurve: 'continuous',
              overflow: 'hidden',
              backgroundColor: c.fill,
              opacity: busy !== null ? 0.4 : pressed ? 0.7 : 1,
            })}>
            {/* Named by the button around it. */}
            <Image source={{ uri: photo.uri }} accessible={false} style={{ width: 96, height: 96 }} contentFit="cover" />
            {/* The whole photo is the button (96 pt), and a press opens its menu:
                the ellipsis only says it has options, as iOS's More does. */}
            <View style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)' }}>
              <SymbolView name="ellipsis" size={12} weight="bold" tintColor="#FFFFFF" />
            </View>
          </Pressable>
          </HoldMenu>
        ))}
        {draft.photos.length < MAX_PHOTOS ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add photo"
            accessibilityState={busy !== null ? { disabled: true } : undefined}
            disabled={busy !== null}
            onPress={() => {
              haptics.tap();
              void addPhoto();
            }}
            style={({ pressed }) => ({
              // At the accessibility sizes the tile grows to fit its words.
              ...(large ? { minWidth: 96, minHeight: 96, padding: 8 } : { width: 96, height: 96 }),
              borderRadius: 10,
              borderCurve: 'continuous',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              // A quiet fill tile on the page, as the quiet capsules are.
              backgroundColor: pressed ? c.pressed : c.fill,
            })}>
            <SymbolView name="camera" size={20} tintColor={c.ink} />
            <BlancText variant="footnote" style={large ? { textAlign: 'center' } : undefined}>
              Add photo
            </BlancText>
          </Pressable>
        ) : null}
      </View>
    </Section>
  );

  // Camera access off: the way to turn it on, as the run screen does for Location.
  // On the capsules' inset, over the tab's own capsules.
  const errorNote = error ? (
    <>
      <FormNote alert>{error}</FormNote>
      {error === CAMERA_OFF ? (
        <View style={{ paddingHorizontal: space.inset, marginTop: 12 }}>
          <Capsule title="Open Settings" variant="quiet" onPress={() => void Linking.openSettings()} />
        </View>
      ) : null}
    </>
  ) : null;

  // ── Describe and photos ──
  if (!result) {
    return (
      <View>
        <Section title="Your meal" style={{ marginTop: 0 }}>
          <FieldArea style={{ marginHorizontal: space.gutter, paddingHorizontal: 0, paddingVertical: 0 }}>
            <TextInput
              selectionColor={c.ink}
              ref={hintField}
              value={draft.hint}
              onChangeText={(text) => setDraft((current) => ({ ...current, hint: text.slice(0, LIMIT) }))}
              editable={busy === null}
              multiline
              // Return closes the keyboard; Analyze meal sends it.
              returnKeyType="done"
              submitBehavior="blurAndSubmit"
              placeholder="e.g. Six Trader Joe’s chicken tikka samosas"
              placeholderTextColor={c.upcoming}
              accessibilityLabel="Your meal"
              style={[typeScale.fieldLines, { color: c.ink, minHeight: 88, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14 }]}
            />
          </FieldArea>
          {/* While it runs, only what is being analyzed stays, so the steps sit higher. */}
          {trail ? null : <FormNote>Photo, text, or both. Include the amount and any added oil or sauce you know about.</FormNote>}
        </Section>
        {trail && draft.photos.length === 0 ? null : photoControls}
        {errorNote}
        {trail ? (
          <AnalysisProgress trail={trail.steps} startedAt={trail.startedAt} />
        ) : (
          <View style={{ paddingHorizontal: space.inset, marginTop: 22 }}>
            <Capsule
              title="Analyze meal"
              size="large"
              fill
              disabled={busy !== null || (!draft.hint.trim() && draft.photos.length === 0)}
              onPress={() => void analyze()}
            />
          </View>
        )}
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
          <BlancText variant="title" accessibilityRole="header" style={{ marginTop: 4 }}>
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
                returnKeyType="go"
                onSubmitEditing={() => void analyze({ clarify: true })}
              />
            </Label>
          </View>
        ) : null}
        {photoControls}
        <FormNote>Add a meal or nutrition label photo. Up to two photos. Remove a photo to replace it.</FormNote>
        {errorNote}
        {trail ? (
          <AnalysisProgress trail={trail.steps} startedAt={trail.startedAt} />
        ) : (
          // At the accessibility sizes the two capsules stack, full width, instead of squeezing.
          <View style={{ flexDirection: large ? 'column' : 'row', gap: 10, paddingHorizontal: space.inset, marginTop: 20 }}>
            <Capsule title="Change meal" variant="quiet" size="large" disabled={busy !== null} onPress={changeMeal} style={large ? { alignSelf: 'stretch' } : undefined} />
            <Capsule
              title={draft.clarificationUsed ? 'Retry estimate' : draft.answer.trim() || draft.photos.length ? 'Update estimate' : 'Use an estimate'}
              size="large"
              disabled={busy !== null}
              onPress={() => void analyze({ clarify: true })}
              style={large ? { alignSelf: 'stretch' } : { flex: 1, alignSelf: 'stretch' }}
            />
          </View>
        )}
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

  // Leaving the review (logged, or a new meal) drops it at once; only a removed food slides away.
  return (
    <LayoutAnimationConfig skipExiting>
      <View>
        <View style={{ paddingHorizontal: space.gutter, marginTop: 16 }}>
          {/* The estimate's totals read as one fact. */}
          <View
            accessible
            accessibilityLabel={speak(
              `${formatWhole(totals.calories)} kcal · protein ${round1(totals.protein)} g · carbs ${round1(totals.carbs)} g · fat ${round1(totals.fat)} g`,
            )}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <RollingText variant="figure" size={56}>
                {formatWhole(totals.calories)}
              </RollingText>
              <Animated.View layout={figureLayout}>
                <BlancText variant="secondary" tone="graphite">
                  kcal
                </BlancText>
              </Animated.View>
            </View>
            <BlancText variant="secondary" tone="graphite">
              P {round1(totals.protein)} g · C {round1(totals.carbs)} g · F {round1(totals.fat)} g
            </BlancText>
          </View>
          {result.summary ? (
            <BlancText variant="footnote" tone="graphite" style={{ marginTop: 8 }}>
              {result.summary}
            </BlancText>
          ) : null}
        </View>
        {editing && items.length > 1 ? <FormNote>Keep one food to replace this entry. Add other foods separately.</FormNote> : null}

        <View style={{ marginTop: 18 }}>
          <Label style={{ overflow: 'hidden' }} layout={rowLayout}>
            {items.map((item, index) => {
              const each = trialFoodTotals(item);
              const expanded = open === item.key;
              // "6 samosas · 24 g protein · Estimate": no protein that rounds to none.
              const line = [
                `${item.quantity} ${item.unit}`.trim(),
                Math.round(each.protein) > 0 ? `${formatWhole(each.protein)} g protein` : null,
                item.evidence === 'label' ? 'From label' : 'Estimate',
              ]
                .filter(Boolean)
                .join(' · ');
              // Tap to adjust; hold for Adjust and Remove; swipe to remove.
              const face = (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={speak(`${item.name} · ${line} · ${formatWhole(each.calories)} kcal`)}
                  accessibilityHint={expanded ? undefined : 'Opens it to adjust'}
                  accessibilityState={{ expanded }}
                  accessibilityActions={frozen ? undefined : [{ name: 'remove', label: 'Remove' }]}
                  onAccessibilityAction={(event) => {
                    if (event.nativeEvent.actionName === 'remove') removeItem(item.key);
                  }}
                  onPress={() => {
                    // a tap while another row stands open only closes that row
                    if (closeOpenSwipeRow()) return;
                    haptics.tap();
                    setOpen(expanded ? null : item.key);
                  }}
                  onLongPress={
                    frozen || hasHoldMenu
                      ? undefined
                      : () => {
                          if (closeOpenSwipeRow()) return;
                          haptics.select();
                          showActionSheet(item.name, itemMenu(item));
                        }
                  }
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 10, paddingLeft: 18, paddingRight: 16, backgroundColor: pressed ? c.pressed : 'transparent' })}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <BlancText variant="bodyStrong" numberOfLines={large ? undefined : 1}>
                      {item.name}
                    </BlancText>
                    <BlancText variant="secondary" tone="graphite" numberOfLines={large ? undefined : 1} style={{ marginTop: 1 }}>
                      {line}
                    </BlancText>
                  </View>
                  <BlancText variant="secondary" tone="graphite" style={{ fontVariant: ['tabular-nums'] }}>
                    {formatWhole(each.calories)}
                  </BlancText>
                  <SymbolView name={expanded ? 'chevron.up' : 'chevron.down'} size={12} weight="semibold" tintColor={c.upcoming} />
                </Pressable>
              );
              return (
                <Animated.View key={item.key} entering={rowEnter} exiting={rowExit} layout={rowLayout}>
                  {index > 0 ? <Hairline /> : null}
                  {frozen ? (
                    face
                  ) : (
                    <SwipeRow name={item.name} actions={[{ label: 'Remove', destructive: true, onPress: () => removeItem(item.key) }]}>
                      <HoldMenu actions={itemMenu(item)} backdrop={c.label}>
                        {face}
                      </HoldMenu>
                    </SwipeRow>
                  )}
                  {expanded ? (
                    <Animated.View entering={rowEnter} style={{ paddingBottom: 12 }}>
                      <Hairline />
                      <FieldRow label="Food name" wide value={item.name} editable={!frozen} onChangeText={(name) => update(item.key, { name })} />
                      <Hairline />
                      <NumberFieldRow
                        label="Amount eaten"
                        value={item.quantity}
                        editable={!frozen}
                        onChangeValue={(quantity) => update(item.key, { quantity, amountConfirmed: true })}
                      />
                      <Hairline />
                      <FieldRow label="Unit" value={item.unit} editable={!frozen} onChangeText={(unit) => update(item.key, { unit, amountConfirmed: true })} />
                      <Hairline />
                      <NumberFieldRow
                        label="Nutrition per"
                        unit={item.unit || 'units'}
                        value={item.basisQuantity}
                        editable={!frozen}
                        onChangeValue={(basisQuantity) => update(item.key, { basisQuantity })}
                      />
                      {(['calories', 'protein', 'carbs', 'fat'] as const).map((key) => (
                        <View key={key}>
                          <Hairline />
                          <NumberFieldRow
                            label={key[0].toUpperCase() + key.slice(1)}
                            unit={key === 'calories' ? 'kcal' : 'g'}
                            value={item[key]}
                            editable={!frozen}
                            onChangeValue={(amount) => update(item.key, { [key]: amount })}
                          />
                        </View>
                      ))}
                      <BlancText variant="footnote" tone="graphite" style={{ marginHorizontal: 18, marginTop: 8 }}>
                        Nutrition is per {item.basisQuantity} {item.unit}; the total scales with the amount eaten.{item.notes ? ` ${item.notes}` : ''}
                      </BlancText>
                      <View style={{ paddingHorizontal: 18, marginTop: 10 }}>
                        <Capsule title="Remove food" variant="quiet" disabled={frozen} onPress={() => removeItem(item.key)} />
                      </View>
                    </Animated.View>
                  ) : null}
                </Animated.View>
              );
            })}
          </Label>
        </View>

        {/* Closes up under the foods as one is removed. */}
        <Animated.View layout={rowLayout}>
          {result.sources.length > 0 ? (
            <Section title="Sources">
              <Label>
                {result.sources.map((source, index) => (
                  <View key={source.url}>
                    {index > 0 ? <Hairline /> : null}
                    <Pressable
                      accessibilityRole="link"
                      onPress={() => {
                        haptics.tap();
                        void Linking.openURL(source.url);
                      }}
                      style={({ pressed }) => ({ paddingVertical: 12, paddingHorizontal: 18, backgroundColor: pressed ? c.pressed : 'transparent' })}>
                      <BlancText variant="secondary" numberOfLines={large ? undefined : 2}>
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
          <View style={{ flexDirection: large ? 'column' : 'row', gap: 10, paddingHorizontal: space.inset, marginTop: 20 }}>
            <Capsule title="Change meal" variant="quiet" size="large" disabled={frozen} onPress={changeMeal} style={large ? { alignSelf: 'stretch' } : undefined} />
            <Capsule
              title={logger.purpose === 'ingredients' ? 'Add ingredients' : editing ? 'Save changes' : 'Log meal'}
              size="large"
              busy={busy === 'save'}
              disabled={!valid || busy !== null}
              onPress={() => void save()}
              style={large ? { alignSelf: 'stretch' } : { flex: 1, alignSelf: 'stretch' }}
            />
          </View>
        </Animated.View>
      </View>
    </LayoutAnimationConfig>
  );
}
