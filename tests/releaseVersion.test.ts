import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { appVersion, nextReleaseVersion } from '../native/scripts/release-version.mjs';

const require = createRequire(import.meta.url);
const script = fileURLToPath(new URL('../native/scripts/release-version.mjs', import.meta.url));
const appJson = JSON.parse(fs.readFileSync(new URL('../native/app.json', import.meta.url), 'utf8'));
const appConfig = require('../native/app.config.js') as (input: { config: Record<string, unknown> }) => {
  version: string;
  ios: { buildNumber?: string; bundleIdentifier: string };
};

describe('next release version', () => {
  it('raises the last digit of the latest TestFlight upload on every ship', () => {
    expect(nextReleaseVersion('2.0.0', '2.0.0')).toBe('2.0.1');
    expect(nextReleaseVersion('2.0.0', '2.0.1')).toBe('2.0.2');
    expect(nextReleaseVersion('2.0.0', '2.0.9')).toBe('2.0.10');
    expect(nextReleaseVersion('2.0.0', '2.3.41')).toBe('2.3.42');
  });

  it('starts at the floor with no uploads yet or only older versions', () => {
    for (const latest of [undefined, null, '', '  ']) expect(nextReleaseVersion('2.0.0', latest)).toBe('2.0.0');
    expect(nextReleaseVersion('2.0.0', '1.0')).toBe('2.0.0');
    expect(nextReleaseVersion('2.0.0', '1.9.99')).toBe('2.0.0');
  });

  it('starts a new line when the floor is raised past the latest upload', () => {
    expect(nextReleaseVersion('2.1.0', '2.0.7')).toBe('2.1.0');
    expect(nextReleaseVersion('2.1.0', '2.1.0')).toBe('2.1.1');
    expect(nextReleaseVersion('3.0.0', '2.9.9')).toBe('3.0.0');
  });

  it('reads short versions from older uploads as zeros', () => {
    expect(nextReleaseVersion('1.0.0', '1.4')).toBe('1.4.1');
    expect(nextReleaseVersion('1.0.0', '2')).toBe('2.0.1');
  });

  it.each(['abc', '2.0.0-beta', '2.0.0.1', '2..0', '-1'])('refuses an unreadable upload version %j', (latest) => {
    expect(() => nextReleaseVersion('2.0.0', latest)).toThrow('Not a version');
  });

  it.each(['2.0', '02.0.0', 'v2.0.0', ''])('refuses a floor that is not three whole numbers: %j', (floor) => {
    expect(() => nextReleaseVersion(floor, '2.0.0')).toThrow('Not a version');
  });

  it('takes app.json, which starts the app at 2.0.0, as the floor', () => {
    expect(appVersion()).toBe('2.0.0');
    expect(appJson.expo.version).toBe('2.0.0');
  });

  it('prints only the next version from the command line, and fails on a bad upload version', () => {
    const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 10_000 });
    expect(run('2.0.0')).toMatchObject({ status: 0, stdout: '2.0.1\n', stderr: '' });
    expect(run('')).toMatchObject({ status: 0, stdout: '2.0.0\n' });
    expect(run()).toMatchObject({ status: 0, stdout: '2.0.0\n' });
    const failed = run('junk');
    expect(failed.status).toBe(1);
    expect(failed.stdout).toBe('');
    expect(failed.stderr).toContain('Not a version: "junk"');
  });
});

describe('native app config version', () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const key of ['HYPER_APP', 'HYPER_APP_VERSION', 'HYPER_BUILD_NUMBER']) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  function resolve(env: Record<string, string | undefined>) {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return appConfig({ config: structuredClone(appJson.expo) });
  }

  it('keeps app.json’s version and build number when a ship sets none', () => {
    const test = resolve({ HYPER_APP: undefined, HYPER_APP_VERSION: undefined, HYPER_BUILD_NUMBER: undefined });
    expect(test.version).toBe('2.0.0');
    expect(test.ios.buildNumber).toBeUndefined();
    const release = resolve({ HYPER_APP: 'release' });
    expect(release.version).toBe('2.0.0');
    expect(release.ios.bundleIdentifier).toBe('app.hyper.mobile');
  });

  it('gives the released app the version and build number a ship chose', () => {
    const release = resolve({ HYPER_APP: 'release', HYPER_APP_VERSION: '2.0.1', HYPER_BUILD_NUMBER: '65' });
    expect(release.version).toBe('2.0.1');
    expect(release.ios.buildNumber).toBe('65');
    expect(release.ios.bundleIdentifier).toBe('app.hyper.mobile');
  });

  it.each(['2.0', '2.0.1-beta', 'latest', '02.0.1'])('refuses HYPER_APP_VERSION=%j', (version) => {
    expect(() => resolve({ HYPER_APP: 'release', HYPER_APP_VERSION: version })).toThrow('HYPER_APP_VERSION');
  });
});
