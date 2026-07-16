import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
for (const name of ['.env.local', '.env']) {
  try { loadEnvFile(path.join(ROOT, name)); } catch { /* optional local env files */ }
}

const SCHEMA_PATH = path.join(ROOT, 'scripts', 'food-photo-schema.json');
const JOB_ROOT = path.join(ROOT, '.tmp', 'food-photo-worker');
const PORT = Number(process.env.PHOTO_WORKER_PORT || 8788);
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 150_000;

const schemaText = await readFile(SCHEMA_PATH, 'utf8');
const schema = JSON.parse(schemaText);
const claudeSchema = JSON.stringify(Object.fromEntries(
  Object.entries(schema).filter(([key]) => key !== '$schema')
));

function hasCommand(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
  return result.status === 0;
}

const installedProviders = [
  hasCommand('codex') ? 'openai' : null,
  hasCommand('claude') ? 'anthropic' : null,
].filter(Boolean);

function authenticatedProviders() {
  const providers = [];
  if (installedProviders.includes('openai')) {
    const status = spawnSync('codex', ['login', 'status'], { encoding: 'utf8' });
    if (status.status === 0 && /logged in/i.test(status.stdout || status.stderr || '')) providers.push('openai');
  }
  if (installedProviders.includes('anthropic')) {
    const status = spawnSync('claude', ['auth', 'status'], { encoding: 'utf8' });
    try {
      if (status.status === 0 && JSON.parse(status.stdout || '{}').loggedIn === true) providers.push('anthropic');
    } catch { /* not authenticated or older CLI output */ }
  }
  return providers;
}

function isOriginAllowed(origin) {
  if (!origin) return true;
  const configured = (process.env.PHOTO_WORKER_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured.includes(origin)) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return /^https:\/\/[a-z0-9.-]+\.ts\.net$/i.test(origin);
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin && isOriginAllowed(origin) ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function sendJson(response, status, body, origin) {
  response.writeHead(status, { ...corsHeaders(origin), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new Error('Photo payload is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function authenticate(request) {
  const authorization = request.headers.authorization || '';
  if (authorization === 'Bearer preview' && process.env.PHOTO_WORKER_ALLOW_PREVIEW === '1') return true;
  if (!authorization.startsWith('Bearer ')) return false;

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) throw new Error('Supabase URL/anon key are missing from the worker environment.');
  const response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/user`, {
    headers: { Authorization: authorization, apikey: anonKey },
  });
  return response.ok;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${command} timed out after ${COMMAND_TIMEOUT_MS / 1000} seconds.`));
    }, COMMAND_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => { if (stdout.length < 1_000_000) stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { if (stderr.length < 200_000) stderr += chunk.toString(); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with code ${code}: ${(stderr.trim() || stdout.trim() || 'no diagnostic output').slice(-1200)}`));
    });
    child.stdin.end(options.stdin || '');
  });
}

function analysisPrompt(imageName, hint) {
  return [
    'Analyze the food photograph in the attached image.',
    'Return each visible food, drink, sauce, dressing, and cooking oil as a separate item.',
    'Estimate the edible grams for the pictured amount. Nutrition values are fallback estimates for that pictured amount, not per 100 g.',
    'Use a concise USDA-friendly search_query including preparation state, such as "chicken breast grilled".',
    'Do not combine the plate into one meal. Lower confidence when portion size, oil, ingredients, or preparation are uncertain.',
    'The user will review every item before it is logged. Do not provide health or medical advice.',
    `Image file: ${imageName}`,
    `User hint: ${hint || 'none'}`,
  ].join('\n');
}

async function analyzeWithCodex(jobDir, imagePath, prompt) {
  const outputPath = path.join(jobDir, 'codex-result.json');
  const args = [
    'exec', '--image', imagePath, '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral',
    '--ignore-user-config', '--ignore-rules', '--output-schema', SCHEMA_PATH,
    '--output-last-message', outputPath, '-C', jobDir, '-',
  ];
  if (process.env.PHOTO_WORKER_OPENAI_MODEL) args.splice(1, 0, '--model', process.env.PHOTO_WORKER_OPENAI_MODEL);
  await runCommand('codex', args, { cwd: jobDir, stdin: prompt });
  return JSON.parse(await readFile(outputPath, 'utf8'));
}

async function analyzeWithClaude(jobDir, prompt) {
  const args = [
    '--print', '--output-format', 'json', '--json-schema', claudeSchema,
    '--tools', 'Read', '--permission-mode', 'dontAsk', '--no-session-persistence', '--safe-mode',
  ];
  if (process.env.PHOTO_WORKER_ANTHROPIC_MODEL) args.push('--model', process.env.PHOTO_WORKER_ANTHROPIC_MODEL);
  args.push(prompt);
  const { stdout } = await runCommand('claude', args, { cwd: jobDir });
  const outer = JSON.parse(stdout);
  if (outer.structured_output) return outer.structured_output;
  if (typeof outer.result === 'string') return JSON.parse(outer.result);
  return outer;
}

function normalizeResult(provider, result) {
  const items = Array.isArray(result?.items) ? result.items : [];
  if (items.length === 0) throw new Error('The model returned no food items.');
  return {
    provider,
    summary: String(result.summary || ''),
    items: items.slice(0, 12).map((item) => ({
      name: String(item.name || '').trim(),
      search_query: String(item.search_query || item.name || '').trim(),
      estimated_grams: Math.max(1, Number(item.estimated_grams) || 100),
      calories: Math.max(0, Number(item.calories) || 0),
      protein_g: Math.max(0, Number(item.protein_g) || 0),
      carbs_g: Math.max(0, Number(item.carbs_g) || 0),
      fat_g: Math.max(0, Number(item.fat_g) || 0),
      confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)),
      notes: String(item.notes || '').trim(),
    })).filter((item) => item.name),
  };
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin || '';
  if (!isOriginAllowed(origin)) return sendJson(response, 403, { error: 'Origin not allowed.' }, origin);
  if (request.method === 'OPTIONS') {
    response.writeHead(204, corsHeaders(origin));
    return response.end();
  }
  if (request.method === 'GET' && request.url === '/health') {
    return sendJson(response, 200, {
      ok: true,
      providers: installedProviders,
      authenticatedProviders: authenticatedProviders(),
    }, origin);
  }
  if (request.method !== 'POST' || request.url !== '/analyze') {
    return sendJson(response, 404, { error: 'Not found.' }, origin);
  }

  let jobDir;
  try {
    if (!await authenticate(request)) return sendJson(response, 401, { error: 'Unauthorized.' }, origin);
    const body = await readJsonBody(request);
    const provider = body.provider === 'anthropic' ? 'anthropic' : 'openai';
    if (!installedProviders.includes(provider)) return sendJson(response, 503, { error: `${provider} CLI is not installed or available.` }, origin);
    if (!authenticatedProviders().includes(provider)) {
      const loginCommand = provider === 'anthropic' ? 'claude /login' : 'codex login';
      return sendJson(response, 503, { error: `${provider} is installed but not authenticated. Run ${loginCommand} on this Mac.` }, origin);
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(body.mimeType)) return sendJson(response, 400, { error: 'Unsupported image type.' }, origin);
    if (typeof body.imageBase64 !== 'string' || body.imageBase64.length === 0) return sendJson(response, 400, { error: 'Image data is missing.' }, origin);

    const image = Buffer.from(body.imageBase64, 'base64');
    if (image.length === 0 || image.length > 3 * 1024 * 1024) return sendJson(response, 400, { error: 'Decoded image is invalid or too large.' }, origin);
    jobDir = path.join(JOB_ROOT, randomUUID());
    await mkdir(jobDir, { recursive: true, mode: 0o700 });
    const extension = body.mimeType === 'image/png' ? 'png' : body.mimeType === 'image/webp' ? 'webp' : 'jpg';
    const imageName = `meal.${extension}`;
    const imagePath = path.join(jobDir, imageName);
    await writeFile(imagePath, image, { mode: 0o600 });

    const prompt = analysisPrompt(imageName, typeof body.hint === 'string' ? body.hint.slice(0, 1000) : '');
    const result = provider === 'anthropic'
      ? await analyzeWithClaude(jobDir, prompt)
      : await analyzeWithCodex(jobDir, imagePath, prompt);
    return sendJson(response, 200, normalizeResult(provider, result), origin);
  } catch (error) {
    return sendJson(response, 500, { error: error instanceof Error ? error.message : 'Photo analysis failed.' }, origin);
  } finally {
    if (jobDir) await rm(jobDir, { recursive: true, force: true }).catch(() => {});
  }
});

await mkdir(JOB_ROOT, { recursive: true, mode: 0o700 });
server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`hyPer photo worker listening on http://127.0.0.1:${PORT} (${installedProviders.join(', ') || 'no providers'})\n`);
});
