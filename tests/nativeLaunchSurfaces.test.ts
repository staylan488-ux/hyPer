import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { LAUNCH_ACTIONS } from '../native/src/lib/launchActions';

// Snap a meal, Log food and Train live in Swift, app.json, the widget plugin
// and TypeScript at once. Swift isn't compiled here, so this reads the files
// and checks that the names, raw values and target membership agree.

const NATIVE = path.resolve(__dirname, '../native');
const read = (file: string) => readFileSync(path.join(NATIVE, file), 'utf8');
const store = read('modules/hyper-launch/ios/HyperLaunchStore.swift');
const snapIntent = read('modules/hyper-launch/shared/SnapMealIntent.swift');
const shortcuts = read('modules/hyper-launch/shared/HyperAppShortcuts.swift');
const control = read('targets/widgets/SnapMealControl.swift');
const bundle = read('targets/widgets/HyperWidgetsBundle.swift');
const plugin = read('plugins/withHyperWidgets.js');

type ShortcutItem = { UIApplicationShortcutItemType: string; UIApplicationShortcutItemTitle: string; UIApplicationShortcutItemIconSymbolName: string };
const quickActions = (JSON.parse(read('app.json')) as { expo: { ios: { infoPlist: { UIApplicationShortcutItems: ShortcutItem[] } } } }).expo.ios.infoPlist
  .UIApplicationShortcutItems;

/** The quoted paths in a `const NAME = [ … ];` list of the plugin. */
function pluginList(name: string): string[] {
  const list = plugin.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`))?.[1] ?? '';
  // Comments say "the card's": drop them before reading the quoted paths.
  return [...list.replace(/\/\/.*$/gm, '').matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

/** Each `struct X: AppIntent { … }` with its body, up to the closing brace at the line start. */
function intents(source: string): Map<string, string> {
  return new Map([...source.matchAll(/struct (\w+): AppIntent \{([\s\S]*?)\n\}/g)].map((match) => [match[1], match[2]]));
}

describe('Snap a meal surfaces', () => {
  it('names the same actions in Swift and TypeScript', () => {
    const body = store.match(/enum HyperLaunchAction: String \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const cases = [...body.matchAll(/^\s*case (\w+)(?: = "([^"]+)")?$/gm)].map((match) => match[2] ?? match[1]);
    expect(cases).toEqual([...LAUNCH_ACTIONS]);
    expect(store).toContain('let prefix = "hyper."');
  });

  it('offers the quick actions as hyper.<action>, Snap a meal nearest the icon', () => {
    expect(quickActions.map((item) => item.UIApplicationShortcutItemType)).toEqual(LAUNCH_ACTIONS.map((action) => `hyper.${action}`));
    expect(quickActions.map((item) => item.UIApplicationShortcutItemTitle)).toEqual(['Snap a meal', 'Log food', 'Train']);
    expect(quickActions.map((item) => item.UIApplicationShortcutItemIconSymbolName)).toEqual(['camera.viewfinder', 'fork.knife', 'dumbbell']);
    // the released app takes the same Info.plist
    expect(read('app.config.js')).toContain('...base.ios.infoPlist');
  });

  it('compiles the control’s intent into the app and the extension, and App Shortcuts into the app only', () => {
    const shared = pluginList('SHARED_FILES');
    const app = pluginList('APP_FILES');
    expect(shared).toEqual(expect.arrayContaining(['modules/hyper-launch/shared/SnapMealIntent.swift', 'modules/hyper-launch/ios/HyperLaunchStore.swift']));
    expect(shared).not.toContain('modules/hyper-launch/shared/HyperAppShortcuts.swift');
    expect(app).toEqual(
      expect.arrayContaining([
        'modules/hyper-launch/shared/SnapMealIntent.swift',
        'modules/hyper-launch/shared/HyperAppShortcuts.swift',
        'modules/hyper-launch/ios/HyperLaunchStore.swift',
      ]),
    );
    for (const file of [...shared, ...app]) expect(existsSync(path.join(NATIVE, file)), file).toBe(true);
    // Copied side by side into ios/HyperWidgets and ios/<app>: basenames must not collide.
    const own = readdirSync(path.join(NATIVE, 'targets/widgets'));
    const extension = [...own, ...shared.map((file) => path.basename(file))];
    expect(new Set(extension).size).toBe(extension.length);
  });

  it('gives every phrase the app’s name once, and none that reads as starting a workout', () => {
    const blocks = [...shortcuts.matchAll(/phrases: \[([\s\S]*?)\]/g)].map((match) => match[1]);
    expect(blocks).toHaveLength(3);
    const phrases = blocks.flatMap((block) => [...block.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1]));
    expect(phrases.length).toBeGreaterThanOrEqual(8);
    for (const phrase of phrases) {
      expect(phrase.split('\\(.applicationName)').length - 1, phrase).toBe(1);
      expect(phrase).not.toMatch(/^(Train with|Start)/);
    }
    expect(new Set(phrases).size).toBe(phrases.length);
  });

  it('opens the app from every intent', () => {
    const all = new Map([...intents(snapIntent), ...intents(shortcuts)]);
    expect([...all.keys()].sort()).toEqual(['LogFoodIntent', 'OpenTrainIntent', 'SnapMealIntent']);
    for (const [name, body] of all) expect(body, name).toContain('static var openAppWhenRun: Bool = true');
    expect(intents(snapIntent).get('SnapMealIntent')).toContain('HyperLaunchStore.post(.snapMeal)');
    expect(intents(shortcuts).get('LogFoodIntent')).toContain('HyperLaunchStore.post(.logFood)');
    expect(intents(shortcuts).get('OpenTrainIntent')).toContain('HyperLaunchStore.post(.train)');
    expect(shortcuts).toMatch(/^import Foundation$/m);
    expect(snapIntent).toMatch(/^import Foundation$/m);
  });

  it('guards what is newer than the iOS 16.4 deployment target', () => {
    expect(shortcuts).toMatch(/@available\(iOS 17\.0, \*\)\nstruct HyperAppShortcuts: AppShortcutsProvider/);
    expect(control).toMatch(/@available\(iOS 18\.0, \*\)\nstruct SnapMealControl: ControlWidget/);
    expect(bundle).toMatch(/if #available\(iOS 18\.0, \*\) \{\s*SnapMealControl\(\)\s*\}/);
  });

  it('calls Snap a meal the same on the control, the shortcut and the quick action', () => {
    expect(control).toContain('.displayName("Snap a meal")');
    expect(control).toContain('Label("Snap a meal", systemImage: "camera.viewfinder")');
    expect(control).toContain('StaticControlConfiguration(kind: "hyper.snap-meal")');
    expect(control).toContain('ControlWidgetButton(action: SnapMealIntent())');
    expect(shortcuts).toMatch(/intent: SnapMealIntent\(\),[\s\S]*?shortTitle: "Snap a meal",\s*systemImageName: "camera.viewfinder"/);
    expect(snapIntent).toContain('static var title: LocalizedStringResource = "Snap a meal"');
    expect(quickActions[0].UIApplicationShortcutItemTitle).toBe('Snap a meal');
  });

  it('keeps intents out of the pod, and the module registered with Expo', () => {
    const podDir = path.join(NATIVE, 'modules/hyper-launch/ios');
    for (const file of readdirSync(podDir).filter((name) => name.endsWith('.swift'))) {
      const source = readFileSync(path.join(podDir, file), 'utf8');
      expect(source, file).not.toContain(': AppIntent');
      expect(source, file).not.toContain('AppShortcutsProvider');
    }
    expect(read('modules/hyper-launch/ios/HyperLaunch.podspec')).toContain("s.source_files = '**/*.{h,m,swift}'");
    expect(existsSync(path.join(NATIVE, 'modules/hyper-launch/HyperLaunch.podspec'))).toBe(false);
    const config = JSON.parse(read('modules/hyper-launch/expo-module.config.json')) as { apple: { modules: string[]; appDelegateSubscribers: string[] } };
    expect(config.apple.modules).toEqual(['HyperLaunchModule']);
    expect(config.apple.appDelegateSubscribers).toEqual(['HyperLaunchAppDelegateSubscriber']);
    expect(read('modules/hyper-launch/ios/HyperLaunchModule.swift')).toContain('Name("HyperLaunch")');
    expect(read('modules/hyper-launch/index.ts')).toContain("requireOptionalNativeModule<HyperLaunchNative>('HyperLaunch')");
  });
});
