// @vitest-environment happy-dom
import { act, createElement, Fragment, useEffect, useState, type ComponentType, type PropsWithChildren } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as analysisProgress from '@/lib/analysisProgress';
import * as foodTrialReview from '@/lib/foodTrialReview';
import * as pendingEntry from '@/lib/pendingEntryId';
import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Snap a meal on the AI tab: each new camera request opens the camera once and
// analyzes the photo with no tap; everything that holds work blocks it.

const CAMERA_OFF = 'Camera access is off. Allow Camera for hyPer in Settings, then try again.';
const Wrap = ({ children }: PropsWithChildren) => createElement(Fragment, null, children);
const Empty = () => null;
const noop = () => {};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

type Photo = { uri: string; width: number; height: number };
type Draft = { hint: string; answer: string; photos: Photo[]; clarificationUsed: boolean; result: unknown; items: unknown[]; saveAsReusable: boolean; saveStarted: boolean };
type Button = { title: string; busy?: boolean; disabled?: boolean; onPress: () => void };
type TabProps = { draft: Draft; setDraft: (update: (draft: Draft) => Draft) => void; cameraRequest?: number; addPhotoRequest?: number };
type AnalyzeRequest = { images: unknown[]; hint: string };

const capsules: Record<string, Button> = {};
type Press = PropsWithChildren<{ accessibilityLabel?: string; accessibilityHint?: string; accessibilityActions?: Array<{ name: string; label: string }>; onPress: () => void }>;
const pressables: Record<string, Press> = {};
let sheet: ((index: number) => Promise<void> | void) | undefined;
let sheetOptions: { options: string[] } | undefined;
let up = false;
const pick = vi.fn<(source: 'camera' | 'library') => Promise<Photo | null>>();
let analysis = deferred<unknown>();
const analyze = vi.fn((request: AnalyzeRequest) => {
  void request;
  return analysis.promise;
});
const announce = vi.fn();
// The steps the progress card is showing, by their running words.
let shownTrail: string[] | null = null;
const openSettings = vi.fn();
const logger = { purpose: 'log', editing: null, beginBusy: () => noop, beginSave: () => noop, when: {}, groups: [], reloadSavedMeals: noop, complete: noop, addIngredients: noop };

const { AiTab, emptyAi } = loadNativeModule<{ AiTab: ComponentType<TabProps>; emptyAi: (hint?: string) => Draft }>('fuel/AiTab.tsx', {
  'expo-image': { Image: Empty },
  // Each symbol by its name, inside the pressable VoiceOver names.
  'expo-symbols': { SymbolView: ({ name }: { name: string }) => createElement('i', { 'data-symbol': name }) },
  'react-native': {
    Alert: { alert: vi.fn() },
    Linking: { openSettings },
    Pressable: (props: Press) => {
      if (props.accessibilityLabel) pressables[props.accessibilityLabel] = props;
      return createElement('div', { 'data-label': props.accessibilityLabel }, props.children);
    },
    Keyboard: { dismiss: noop },
    TextInput: Empty,
    View: Wrap,
  },
  'react-native-reanimated': { default: { View: Wrap }, LayoutAnimationConfig: Wrap },
  '@/lib/analysisProgress': analysisProgress,
  '@/lib/foodTrialReview': foodTrialReview,
  '@/lib/foodPersistence': {},
  '@/lib/foodTrial': {
    analyzeFoodTrial: analyze,
    trialFoodTotals: () => ({ calories: 0, protein: 0, carbs: 0, fat: 0 }),
    trialIngredientFood: noop,
    trialItemFood: noop,
    trialLogSource: noop,
  },
  '@/lib/mealComposition': { createMealIngredient: noop },
  '@/lib/pendingEntryId': pendingEntry,
  '~/components/BlancText': { BlancText: Wrap },
  '~/components/Capsule': {
    Capsule: (props: Button) => {
      capsules[props.title] = props;
      return createElement('button', { 'data-title': props.title, 'data-busy': props.busy ? 'yes' : 'no' });
    },
  },
  '~/components/Form': {
    FieldRow: Empty,
    FormNote: ({ alert, children }: PropsWithChildren<{ alert?: boolean }>) => createElement('p', alert ? { 'data-alert': 'yes' } : {}, children),
    NumberFieldRow: Empty,
    ToggleRow: Empty,
  },
  '~/components/Label': { Label: Wrap },
  '~/components/HoldMenu': { HoldMenu: Wrap, hasHoldMenu: true, showActionSheet: noop },
  '~/components/RollingText': { RollingText: Wrap },
  '~/components/Row': { Hairline: Empty },
  '~/components/Section': { Section: Wrap },
  '~/components/SwipeRow': { closeOpenSwipeRow: () => false, SwipeRow: Wrap },
  // VoiceOver is off in a test; what the tab announces is recorded.
  '~/lib/accessibility': { ...silentAccessibility, announce },
  '~/lib/format': { formatWhole: String },
  '~/lib/foodLogger': { saveFoodEntry: vi.fn(), workerAccessToken: async () => 'token' },
  '~/lib/haptics': { haptics: { tap: noop, select: noop, success: noop, error: noop } },
  '~/lib/motion': { figureLayout: {}, rowEnter: {}, rowExit: {}, rowLayout: {} },
  '~/platform/previewFlag': { isPreviewActive: () => false },
  '~/theme/blanc': { space: { gutter: 20, inset: 16 }, type: { fieldLines: {} }, useBlanc: () => ({}) },
  './AnalysisProgress': {
    AnalysisProgress: ({ trail }: { trail: { lines: { now: string }[] } }) => {
      shownTrail = trail.lines.map((line) => line.now);
      return createElement('section', { 'data-progress': 'yes' });
    },
  },
  './context': { useLogger: () => logger },
  './PhotoTab': {
    CAMERA_OFF,
    prepareImage: async () => ({ imageBase64: 'b64', mimeType: 'image/jpeg' }),
    pickFoodPhoto: pick,
    foodPickerUp: () => up,
    // a photo's menu (PhotoTab holds it as up until it answers)
    showPhotoChoices: (options: { options: string[] }, callback: (index: number) => Promise<void>) => { sheetOptions = options; sheet = callback; },
    dropPhotoChoices: noop,
  },
  './WhenBlock': { WhenBlock: Empty },
});

const shot: Photo = { uri: 'shot', width: 10, height: 10 };
let current: Draft;
function Host({ request, initial, addPhoto = 0 }: { request: number; initial?: Draft; addPhoto?: number }) {
  const [draft, setDraft] = useState<Draft>(() => initial ?? emptyAi());
  useEffect(() => { current = draft; });
  return createElement(AiTab, { draft, setDraft: (update) => setDraft(update), cameraRequest: request, addPhotoRequest: addPhoto });
}

let host: HTMLDivElement;
let root: Root;
const render = async (request: number, initial?: Draft, addPhoto = 0) => {
  await act(async () => { root.render(createElement(Host, { request, initial, addPhoto })); });
};
const settle = () => act(async () => { for (let tick = 0; tick < 20; tick += 1) await Promise.resolve(); });
const alertText = () => host.querySelector('[data-alert]')?.textContent ?? null;
const hasCapsule = (title: string) => host.querySelector(`button[data-title="${title}"]`) !== null;

beforeEach(() => {
  up = false;
  shownTrail = null;
  sheet = undefined;
  sheetOptions = undefined;
  for (const key of Object.keys(pressables)) delete pressables[key];
  analysis = deferred();
  pick.mockReset();
  for (const key of Object.keys(capsules)) delete capsules[key];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('AI tab: Snap a meal', () => {
  it('takes one photo and starts one analysis with it, without a tap', async () => {
    const photo = deferred<Photo | null>();
    pick.mockReturnValueOnce(photo.promise);
    await render(0);
    await render(1);
    expect(pick).toHaveBeenCalledOnce();
    expect(pick).toHaveBeenCalledWith('camera');
    await act(async () => { photo.resolve(shot); });
    await settle();
    expect(analyze).toHaveBeenCalledOnce();
    expect(analyze.mock.calls[0][0].images).toHaveLength(1);
    expect(announce).toHaveBeenCalledWith('Analyzing meal');
    expect(current.photos).toEqual([shot]);
    // The steps take Analyze meal's place while it runs.
    expect(hasCapsule('Analyze meal')).toBe(false);
    expect(shownTrail).toEqual(['Sending your photo']);
  });

  it('shows each step the analysis reports, then the button again', async () => {
    pick.mockResolvedValueOnce(shot);
    await render(0);
    await render(1);
    await settle();
    const { onProgress } = analyze.mock.calls[0][0] as AnalyzeRequest & { onProgress: (step: unknown) => void };
    await act(async () => { onProgress({ step: 'look' }); });
    await act(async () => { onProgress({ step: 'search', products: ['Fixture samosas'] }); });
    expect(shownTrail).toEqual(['Sending your photo', 'Looking at your photo', 'Searching the web']);
    await act(async () => { analysis.reject(new Error('Analysis did not finish successfully.')); });
    await settle();
    expect(host.querySelector('[data-progress]')).toBeNull();
    expect(hasCapsule('Analyze meal')).toBe(true);
    expect(alertText()).toBe('Analysis did not finish successfully.');
  });

  it('leaves the tab as it was when the camera is cancelled', async () => {
    pick.mockResolvedValueOnce(null);
    await render(0);
    await render(1);
    await settle();
    expect(analyze).not.toHaveBeenCalled();
    expect(alertText()).toBeNull();
    expect(current.photos).toEqual([]);
  });

  it('says camera access is off, with the way to Settings', async () => {
    pick.mockRejectedValueOnce(new Error(CAMERA_OFF));
    await render(0);
    await render(1);
    await settle();
    expect(alertText()).toBe(CAMERA_OFF);
    expect(hasCapsule('Open Settings')).toBe(true);
    capsules['Open Settings'].onPress();
    expect(openSettings).toHaveBeenCalledOnce();
    expect(analyze).not.toHaveBeenCalled();
  });

  it('never opens a second picker', async () => {
    up = true;
    await render(0);
    await render(1);
    expect(pick).not.toHaveBeenCalled();
  });

  it('does not open the camera while an analysis runs', async () => {
    pick.mockResolvedValueOnce(shot);
    await render(0);
    await render(1);
    await settle();
    expect(analyze).toHaveBeenCalledOnce();
    await render(2);
    expect(pick).toHaveBeenCalledOnce();
  });

  it('does not open the camera over an estimate or with two photos', async () => {
    await render(0, { ...emptyAi(), result: { items: [], clarification: 'Which sauce?', summary: '', sources: [] } });
    await render(1, undefined);
    expect(pick).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    root = createRoot(host);
    await render(0, { ...emptyAi(), photos: [shot, shot] });
    await render(1);
    expect(pick).not.toHaveBeenCalled();
  });

  it('does not replay a request it was mounted with', async () => {
    await render(1);
    expect(pick).not.toHaveBeenCalled();
    pick.mockResolvedValueOnce(null);
    await render(2);
    expect(pick).toHaveBeenCalledOnce();
  });

  it('adds the photo Log food’s Photo button takes, and waits for Analyze meal so words can join it', async () => {
    pick.mockResolvedValueOnce(shot);
    await render(0, undefined, 0);
    await render(0, undefined, 1);
    await settle();
    expect(pick).toHaveBeenCalledOnce();
    expect(pick).toHaveBeenCalledWith('camera');
    expect(current.photos).toEqual([shot]);
    expect(analyze).not.toHaveBeenCalled();
    expect(hasCapsule('Analyze meal')).toBe(true);
  });

  it('does not open the camera from Photo over an estimate', async () => {
    await render(0, { ...emptyAi(), result: { items: [], summary: 'Eggs' } } as Draft, 0);
    await render(0, undefined, 1);
    await settle();
    expect(pick).not.toHaveBeenCalled();
  });

  it('analyzes the photo together with a typed description', async () => {
    pick.mockResolvedValueOnce(shot);
    await render(0, emptyAi('Two eggs on toast'));
    await render(1);
    await settle();
    expect(analyze).toHaveBeenCalledOnce();
    expect(analyze.mock.calls[0][0]).toMatchObject({ hint: 'Two eggs on toast' });
    expect(analyze.mock.calls[0][0].images).toHaveLength(1);
  });

  it('opens the same camera straight from Add photo, with no choices asked first', async () => {
    pick.mockRejectedValueOnce(new Error(CAMERA_OFF));
    await render(0);
    await act(async () => { pressables['Add photo'].onPress(); });
    await settle();
    expect(sheet).toBeUndefined();
    expect(pick).toHaveBeenCalledOnce();
    expect(pick).toHaveBeenCalledWith('camera');
    expect(alertText()).toBe(CAMERA_OFF);
    expect(hasCapsule('Open Settings')).toBe(true);
  });

  it('adds the photo the camera screen hands back from Add photo, without analyzing it', async () => {
    pick.mockResolvedValueOnce(shot);
    await render(0);
    await act(async () => { pressables['Add photo'].onPress(); });
    await settle();
    expect(current.photos).toEqual([shot]);
    expect(analyze).not.toHaveBeenCalled();
  });
});

describe('AI tab: a photo added', () => {
  it('marks the photo with an ellipsis, not a cross, since a press opens its menu', async () => {
    await render(0, { ...emptyAi(), photos: [shot] });
    const tile = host.querySelector('[data-label="Meal photo 1"]');
    expect(tile).not.toBeNull();
    expect([...tile!.querySelectorAll('[data-symbol]')].map((symbol) => symbol.getAttribute('data-symbol'))).toEqual(['ellipsis']);
    expect(host.querySelector('[data-symbol="xmark"]')).toBeNull();
    // the whole tile is the button, named for VoiceOver, with Remove photo as its own action
    expect(pressables['Meal photo 1']).toMatchObject({ accessibilityHint: 'Offers to remove it', accessibilityActions: [{ name: 'remove', label: 'Remove photo' }] });
    await act(async () => { pressables['Meal photo 1'].onPress(); });
    expect(sheetOptions!.options).toEqual(['Remove photo', 'Cancel']);
    await act(async () => { await sheet!(1); });
    expect(current.photos).toEqual([shot]);
    await act(async () => { pressables['Meal photo 1'].onPress(); });
    await act(async () => { await sheet!(0); });
    expect(current.photos).toEqual([]);
    expect(host.querySelector('[data-label="Meal photo 1"]')).toBeNull();
  });
});
