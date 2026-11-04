import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../native/scripts/check-release.sh', import.meta.url));
const HOST = 'https://nnwfaaxmyvqsdnfcdxom.supabase.co';
let temporaryDirectory: string;

type Plist = Record<string, string>;
interface Archive {
  app: Plist;
  bundle: string;
  appConfig: Record<string, unknown> | null;
  appConfigPath: string;
  extensions: Plist[];
}

function healthy(): Archive {
  return {
    app: { CFBundleIdentifier: 'app.hyper.mobile', CFBundleVersion: '65', CFBundleShortVersionString: '2.0.1' },
    bundle: `const url = "${HOST}";`,
    appConfig: { name: 'hyPer Native', version: '2.0.1', ios: { bundleIdentifier: 'app.hyper.mobile', version: 'not this' } },
    appConfigPath: 'EXConstants.bundle/app.config',
    extensions: [{ CFBundleIdentifier: 'app.hyper.mobile.HyperWidgets', CFBundleVersion: '65', CFBundleShortVersionString: '2.0.1' }],
  };
}

function writeFile(file: string, contents: string, mode?: number) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, mode === undefined ? undefined : { mode });
}

/** The fake PlistBuddy reads Key=value lines, so a "plist" here is plain text. */
const plistText = (plist: Plist) => Object.entries(plist).map(([key, value]) => `${key}=${value}\n`).join('');

function check(archive: Archive, args: string[] = ['65', '2.0.1']) {
  const work = fs.mkdtempSync(path.join(temporaryDirectory, 'archive-'));
  const app = path.join(work, 'Payload/hyPer.app');
  writeFile(path.join(app, 'Info.plist'), plistText(archive.app));
  writeFile(path.join(app, 'main.jsbundle'), archive.bundle);
  if (archive.appConfig) writeFile(path.join(app, archive.appConfigPath), JSON.stringify(archive.appConfig));
  archive.extensions.forEach((plist, index) => {
    writeFile(path.join(app, `PlugIns/Extension${index}.appex/Info.plist`), plistText(plist));
  });
  const ipa = path.join(temporaryDirectory, `${path.basename(work)}.ipa`);
  const zipped = spawnSync('zip', ['-qr', ipa, 'Payload'], { cwd: work, encoding: 'utf8' });
  expect(zipped.status, zipped.stderr).toBe(0);

  const result = spawnSync('/bin/bash', [script, ipa, ...args], {
    env: {
      PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
      TMPDIR: temporaryDirectory,
      PLIST_BUDDY: path.join(temporaryDirectory, 'PlistBuddy'),
    },
    encoding: 'utf8',
    timeout: 10_000,
  });
  expect(result.error).toBeUndefined();
  return { status: result.status, output: result.stdout + result.stderr };
}

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-check-release-'));
  writeFile(path.join(temporaryDirectory, 'PlistBuddy'), `#!/bin/bash
set -eu
[ "$1" = -c ] || exit 64
key="\${2#Print :}"
line="$(/usr/bin/grep -E "^$key=" "$3")" || { echo "Print: Entry, \\":$key\\", Does Not Exist" >&2; exit 1; }
printf '%s\\n' "\${line#*=}"
`, 0o755);
});

afterEach(() => {
  if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe('release archive check', () => {
  it('passes an archive whose app, extension and embedded app config carry the chosen version and build', () => {
    const result = check(healthy());
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain('Release check passed: app.hyper.mobile 2.0.1 build 65');
    expect(fs.readdirSync(temporaryDirectory).filter((name) => name.startsWith('hyper-release-check.'))).toEqual([]);
  });

  it('still checks that the parts agree when no build number or version is given', () => {
    expect(check(healthy(), []).status).toBe(0);
    const archive = healthy();
    archive.extensions[0].CFBundleShortVersionString = '2.0.0';
    expect(check(archive, []).output).toContain("Extension version 2.0.0 does not match the app's 2.0.1");
  });

  it('finds the app config inside a framework as well', () => {
    const archive = healthy();
    archive.appConfigPath = 'Frameworks/EXConstants.framework/EXConstants.bundle/app.config';
    expect(check(archive).status).toBe(0);
  });

  it.each([
    ['another version than the one chosen', (a: Archive) => { a.app.CFBundleShortVersionString = '2.0.0'; }, 'Version 2.0.0, expected 2.0.1'],
    ['another build number than the one chosen', (a: Archive) => { a.app.CFBundleVersion = '64'; }, 'Build number 64, expected 65'],
    ['an extension on an older version', (a: Archive) => { a.extensions[0].CFBundleShortVersionString = '2.0.0'; }, "Extension version 2.0.0 does not match the app's 2.0.1"],
    ['an extension with another build', (a: Archive) => { a.extensions[0].CFBundleVersion = '64'; }, "Extension build 64 does not match the app's 65"],
    ['an extension without a version', (a: Archive) => { delete a.extensions[0].CFBundleShortVersionString; }, 'Does Not Exist'],
    ['an About screen config on another version', (a: Archive) => { a.appConfig = { ...a.appConfig, version: '2.0.0' }; }, 'The embedded app config says version 2.0.0, the app 2.0.1'],
    ['an About screen config without a version', (a: Archive) => { a.appConfig = { name: 'hyPer' }; }, 'The embedded app config says version , the app 2.0.1'],
    ['no embedded app config', (a: Archive) => { a.appConfig = null; }, 'The archive has no embedded app config'],
    ['the wrong bundle ID', (a: Archive) => { a.app.CFBundleIdentifier = 'app.hyper.native'; }, 'Wrong bundle ID: app.hyper.native'],
    ['the wrong extension ID', (a: Archive) => { a.extensions[0].CFBundleIdentifier = 'app.hyper.native.widgets'; }, 'Wrong extension ID'],
    ['no production host', (a: Archive) => { a.bundle = 'const url = "https://example.invalid";'; }, 'The bundle has no production host.'],
    ['a local test backend', (a: Archive) => { a.bundle += ' const local = "http://127.0.0.1:54321";'; }, 'The bundle mentions a local test backend.'],
  ])('refuses %s', (_name, change, message) => {
    const archive = healthy();
    change(archive);
    const result = check(archive);
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain(message);
  });
});
