import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

it.skipIf(process.platform !== 'darwin')('serializes native launch presses across threads and processes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-launch-mailbox-'));
  try {
    const executable = join(directory, 'check');
    execFileSync('xcrun', [
      'swiftc', '-swift-version', '5',
      resolve('native/modules/hyper-launch/ios/HyperLaunchStore.swift'),
      resolve('tests/launchMailbox.swift'), '-o', executable,
    ], { timeout: 60_000, stdio: 'pipe' });
    const output = execFileSync(executable, [directory], { timeout: 30_000, encoding: 'utf8' });
    expect(output).toContain('cross-process locking passed');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 90_000);
