#!/usr/bin/env node
// The version the next TestFlight upload carries (CFBundleShortVersionString),
// chosen like the build number: from the latest upload, with nothing written
// back to the repository. Each ship raises the last digit by one
// (2.0.4 -> 2.0.5). app.json's version is the floor: raising it there (to
// 2.1.0, say) makes the next ship 2.1.0, and the ones after 2.1.1, 2.1.2...
//   node native/scripts/release-version.mjs [latest-testflight-version]
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const RELEASE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** [major, minor, patch] from "2.0.1"; missing parts of "1.0" or "3" count as 0. */
function parts(version, { exact }) {
  const text = String(version).trim();
  const pattern = exact ? RELEASE_VERSION : /^\d+(\.\d+){0,2}$/;
  if (!pattern.test(text)) throw new Error(`Not a version: "${text}"`);
  const numbers = text.split('.').map(Number);
  while (numbers.length < 3) numbers.push(0);
  return numbers;
}

function compare(a, b) {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

/**
 * The next release version: the floor when TestFlight has nothing at or above
 * it (no uploads yet, or only older versions), otherwise the latest upload's
 * version with its last digit raised by one.
 */
export function nextReleaseVersion(floor, latest) {
  const base = parts(floor, { exact: true });
  if (latest === undefined || latest === null || String(latest).trim() === '') return base.join('.');
  const last = parts(latest, { exact: false });
  if (compare(last, base) < 0) return base.join('.');
  return [last[0], last[1], last[2] + 1].join('.');
}

/** app.json's version, the floor for every release. */
export function appVersion() {
  const appJson = JSON.parse(fs.readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
  return appJson.expo.version;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  try {
    process.stdout.write(`${nextReleaseVersion(appVersion(), process.argv[2])}\n`);
  } catch (error) {
    process.stderr.write(`release-version: ${error.message}\n`);
    process.exit(1);
  }
}
