import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const source = fileURLToPath(new URL('../native/scripts/prepare-release.sh', import.meta.url));
let temporaryDirectory: string;
let native: string;
let fixtureEnv: NodeJS.ProcessEnv;

function executable(relative: string, contents: string) {
  const file = path.join(temporaryDirectory, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `#!/bin/bash\nset -eu\n${contents}\n`, { mode: 0o755 });
}

function prepare(mode = 'healthy', args = ['65'], overrides: NodeJS.ProcessEnv = {}) {
  const result = spawnSync('/bin/bash', [path.join(native, 'scripts/prepare-release.sh'), ...args], {
    cwd: temporaryDirectory,
    env: { ...fixtureEnv, TEST_MODE: mode, ...overrides },
    encoding: 'utf8',
    timeout: 10_000,
  });
  expect(result.error).toBeUndefined();
  const events = fs.readFileSync(path.join(temporaryDirectory, 'events'), 'utf8').trim();
  return { status: result.status, output: result.stdout + result.stderr, events: events ? events.split('\n') : [] };
}

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-prepare-release-'));
  native = path.join(temporaryDirectory, 'native with spaces');
  fs.mkdirSync(path.join(native, 'scripts'), { recursive: true });
  fs.copyFileSync(source, path.join(native, 'scripts/prepare-release.sh'));
  fs.writeFileSync(path.join(temporaryDirectory, 'events'), '');
  fixtureEnv = {
    PATH: `${path.join(temporaryDirectory, 'bin')}:/usr/bin:/bin`,
    TMPDIR: temporaryDirectory,
    TEST_ROOT: temporaryDirectory,
    HYPER_APP: 'release',
    EXPO_PUBLIC_HYPER_PREVIEW: '0',
  };

  executable('bin/npx', `
printf 'prebuild|%s|%s|%s|%s|%s\\n' "$HYPER_BUILD_NUMBER" "$HYPER_APP" "$EXPO_PUBLIC_HYPER_PREVIEW" "$PWD" "$*" >> "$TEST_ROOT/events"
[ "$TEST_MODE" != prebuild-failure ] || exit 13
mkdir -p ios/Pods/hermes-engine ios/Pods/React-Core-prebuilt ios/Pods/UnrelatedPod
touch ios/Pods/hermes-engine/incomplete ios/Pods/React-Core-prebuilt/incomplete ios/Pods/UnrelatedPod/preserve
`);
  executable('bin/pod', `
printf 'pod %s\\n' "$*" >> "$TEST_ROOT/events"
if [ "$1" = cache ]; then
  [ "$TEST_MODE" != cache-failure ] || exit 25
  exit 0
fi
[ "$PWD" = "$TEST_ROOT/native with spaces/ios" ] || exit 99
count=0
[ ! -f "$TEST_ROOT/pod-count" ] || count=$(cat "$TEST_ROOT/pod-count")
count=$((count + 1))
echo "$count" > "$TEST_ROOT/pod-count"
case "$TEST_MODE" in
  other-failure) echo '[!] Could not resolve dependency SomeOtherPod'; exit 23 ;;
  other-framework) echo "[!] The plist file at path '$PWD/Pods/SomeOtherPod/Other.xcframework/Info.plist' doesn't exist."; exit 23 ;;
  hermes-once|react-core-once|hermes-repeated|cache-failure)
    if [ "$count" -eq 1 ] || [ "$TEST_MODE" = hermes-repeated ]; then
      if [ "$TEST_MODE" = react-core-once ]; then
        framework=React-Core-prebuilt/React.xcframework
      else
        framework=hermes-engine/destroot/Library/Frameworks/universal/hermesvm.xcframework
      fi
      echo "[!] The plist file at path '$PWD/Pods/$framework/Info.plist' doesn't exist."
      if [ "$count" -eq 1 ]; then exit 23; else exit 24; fi
    fi ;;
esac
if [ "$TEST_MODE" != missing-workspace ]; then
  mkdir -p hyPerNative.xcworkspace
  touch hyPerNative.xcworkspace/contents.xcworkspacedata
fi
`);
  executable('native with spaces/scripts/use-rn-core.sh', `
printf 'frameworks %s\\n' "$*" >> "$TEST_ROOT/events"
[ "$TEST_MODE" != framework-failure ] || exit 26
`);
});

afterEach(() => {
  if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe('release project preparation', () => {
  it('exports the build number, separates prebuild from pods, then selects Release frameworks', () => {
    const result = prepare();
    expect(result.status, result.output).toBe(0);
    expect(result.events).toEqual([
      `prebuild|65|release|0|${native}|expo prebuild --platform ios --clean --no-install`,
      'pod install',
      'frameworks Release',
    ]);
    expect(fs.readdirSync(temporaryDirectory).filter((name) => name.startsWith('hyper-pods.'))).toEqual([]);
  });

  it('stops on prebuild failure without invoking CocoaPods', () => {
    const result = prepare('prebuild-failure');
    expect(result.status, result.output).toBe(13);
    expect(result.events).toHaveLength(1);
  });

  it.each(['other-failure', 'other-framework'])('preserves %s and stops before cache repair or framework selection', (mode) => {
    const result = prepare(mode);
    expect(result.status, result.output).toBe(23);
    expect(result.output).toContain('SomeOtherPod');
    expect(result.events.slice(1)).toEqual(['pod install']);
    expect(fs.existsSync(path.join(native, 'ios/Pods/hermes-engine/incomplete'))).toBe(true);
  });

  it.each(['hermes-once', 'react-core-once'])('repairs only the two native framework caches once for %s', (mode) => {
    const result = prepare(mode);
    expect(result.status, result.output).toBe(0);
    expect(result.events.slice(1)).toEqual([
      'pod install', 'pod cache clean hermes-engine --all', 'pod cache clean React-Core-prebuilt --all',
      'pod install', 'frameworks Release',
    ]);
    expect(fs.existsSync(path.join(native, 'ios/Pods/hermes-engine/incomplete'))).toBe(false);
    expect(fs.existsSync(path.join(native, 'ios/Pods/React-Core-prebuilt/incomplete'))).toBe(false);
    expect(fs.existsSync(path.join(native, 'ios/Pods/UnrelatedPod/preserve'))).toBe(true);
  });

  it('stops after the single retry fails and preserves the retry exit status', () => {
    const result = prepare('hermes-repeated');
    expect(result.status, result.output).toBe(24);
    expect(result.events.slice(1)).toEqual([
      'pod install', 'pod cache clean hermes-engine --all', 'pod cache clean React-Core-prebuilt --all', 'pod install',
    ]);
  });

  it('stops when cleaning the Hermes cache fails', () => {
    const result = prepare('cache-failure');
    expect(result.status, result.output).toBe(25);
    expect(result.events.slice(1)).toEqual(['pod install', 'pod cache clean hermes-engine --all']);
    expect(fs.existsSync(path.join(native, 'ios/Pods/hermes-engine/incomplete'))).toBe(true);
  });

  it('requires CocoaPods to produce the workspace before framework selection', () => {
    const result = prepare('missing-workspace');
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain('CocoaPods did not create hyPerNative.xcworkspace');
    expect(result.events.slice(1)).toEqual(['pod install']);
  });

  it('propagates framework selection failure', () => {
    const result = prepare('framework-failure');
    expect(result.status, result.output).toBe(26);
    expect(result.events.at(-1)).toBe('frameworks Release');
  });

  it.each([[], [''], ['abc'], ['65; touch unsafe'], ['1.5'], ['-1']].map((args) => ({ args })))('rejects invalid build arguments $args before running tools', ({ args }) => {
    const result = prepare('healthy', args);
    expect(result.status).not.toBe(0);
    expect(result.events).toEqual([]);
  });

  it.each([
    { HYPER_APP: undefined }, { HYPER_APP: 'preview' },
    { EXPO_PUBLIC_HYPER_PREVIEW: undefined }, { EXPO_PUBLIC_HYPER_PREVIEW: '1' },
  ])('rejects non-release environment %j before running tools', (overrides) => {
    const result = prepare('healthy', ['65'], overrides);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('is required');
    expect(result.events).toEqual([]);
  });
});
