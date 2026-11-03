import assert from 'node:assert/strict';
import test from 'node:test';
import { errorTail } from './error-tail.mjs';

test('reports the CocoaPods cause instead of earlier test errors or Fastlane release notes', () => {
  const result = errorTail([
    '==> Running tests, lint and the native type-check (ship aborts on failure)',
    "Error creating workout sets: { message: 'offline' }",
    'Tests 1937 passed (1937)',
    '==> Archiving, checking + uploading the native app to TestFlight',
    '[13:47:36]: ▸ \x1b[35m⚠️ Something went wrong running `pod install` in the `ios` directory.\x1b[0m',
    '[13:47:36]: ▸ \x1b[35mCommand `pod install` failed.\x1b[0m',
    "[13:47:36]: ▸ \x1b[35m└─ Cause: The plist file at path `/build/native/ios/Pods/hermes-engine/destroot/Library/Frameworks/universal/hermesvm.xcframework/Info.plist` doesn't exist.\x1b[0m",
    '[13:47:36]: ▸ pod install --repo-update --ansi exited with non-zero code: 1',
    '[13:47:36]: ---------------------------------------',
    '[13:47:36]: Step: use-rn-core.sh Release',
    '[13:47:36]: Extracting unrelated tarball',
    '[13:47:37]: Error setting value for option workspace',
    '[13:47:37]: fastlane finished with errors',
    "[!] Workspace file not found at path '/build/native/ios/hyPerNative.xcworkspace'",
    '# fastlane 2.241.2 is available. You are on 2.237.0.',
    '* [spaceship] prevent frozen error when logging response',
    '* [docs] Testing.md: a spec for a fix has to fail without the fix',
  ].join('\n'));
  assert.match(result, /Command `pod install` failed/);
  assert.match(result, /hermesvm\.xcframework\/Info\.plist` doesn't exist/);
  assert.doesNotMatch(result, /offline|spaceship|Testing\.md|unrelated tarball|---|\x1b|\[13:47/);
});

test('retains multiline compiler context and neutralizes embedded Markdown fences', () => {
  const result = errorTail('==> Archiving\nCompiling App.swift\nApp.swift:42: error: missing argument\n```\n  save()\n      ^\n```\n** ARCHIVE FAILED **');
  assert.match(result, /Compiling App\.swift\nApp\.swift:42: error: missing argument/);
  assert.match(result, /save\(\)\n      \^/);
  assert.doesNotMatch(result, /```/);
});

test('keeps the beginning of long failures within the Discord diagnostic budget', () => {
  const result = errorTail(`fatal: root cause ${'detail '.repeat(1000)}`);
  assert.match(result, /^fatal: root cause/);
  assert.equal(result.length, 1200);
  assert.match(result, /…$/);
});

test('falls back to the output tail without importing release notes or ANSI controls', () => {
  const result = errorTail(`==> Preparing\r\n${'progress '.repeat(300)}\r\n\x1b[31mProcess terminated\x1b[0m\n# fastlane 2.241.2 is available. You are on 2.237.0.\n* error release note`);
  assert.equal(result.length, 1200);
  assert.match(result, /Process terminated$/);
  assert.doesNotMatch(result, /release note|\x1b|\r/);
});

test('provides a useful fallback when the process emitted nothing', () => {
  assert.equal(errorTail(''), 'No diagnostic output was captured.');
});
