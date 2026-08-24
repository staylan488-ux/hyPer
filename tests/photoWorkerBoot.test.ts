import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';

/**
 * Boots the real worker and asks it a question.
 *
 * This exists because `node --check` validates syntax only. A missing function
 * is a RUNTIME error, so a file that had lost `authenticatedProviders` entirely
 * still passed every check and every unit test, deployed cleanly, reported
 * `systemctl is-active`, held its port open — and returned an empty body to
 * every request. Nothing in the suite noticed, because nothing ever started it.
 */
const WORKER = path.resolve(__dirname, '../scripts/photo-food-worker.mjs');
const PORT = 8799;

async function bootWorker() {
  const child = spawn(process.execPath, [WORKER], {
    env: {
      ...process.env,
      PHOTO_WORKER_PORT: String(PORT),
      PHOTO_WORKER_HOST: '127.0.0.1',
      NODE_ENV: 'test',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'test-key',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });

  const started = Date.now();
  while (Date.now() - started < 20_000) {
    if (child.exitCode != null) {
      throw new Error(`worker exited early (code ${child.exitCode}):\n${stderr}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      return { child, response, stderr: () => stderr };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  child.kill('SIGKILL');
  throw new Error(`worker never answered /health:\n${stderr}`);
}

describe('the worker actually boots and answers', () => {
  it('serves /health with a parseable body', async () => {
    const { child, response, stderr } = await bootWorker();
    try {
      expect(response.ok, `/health returned ${response.status}. stderr:\n${stderr()}`).toBe(true);
      const body = await response.json() as { providers?: unknown; authenticatedProviders?: unknown };
      // the empty-body failure returned 200-with-nothing or nothing at all;
      // asserting on shape is what distinguishes "up" from "actually working"
      expect(Array.isArray(body.providers)).toBe(true);
      expect(Array.isArray(body.authenticatedProviders)).toBe(true);
      expect(stderr()).not.toMatch(/ReferenceError|TypeError|is not defined|is not a function/);
    } finally {
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), new Promise((r) => setTimeout(r, 3_000))]);
    }
  }, 30_000);
});
