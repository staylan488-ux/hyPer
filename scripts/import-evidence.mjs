#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_OWNER = 'staylan488-ux';
const DEFAULT_REPO = 'hypertrophy-coach';
const DEFAULT_REF = 'main';
const DEFAULT_REFERENCES_PATH = 'references';
const PARSER_VERSION = 'v0.3-rules-only';

const REFERENCE_FILES = {
  volumeCanon: 'beardsley-canon-volume-frequency-progression.md',
  exerciseCanon: 'beardsley-canon-exercise-selection.md',
  romCanon: 'beardsley-canon-long-lengths-rom.md',
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const defaultOutPath = path.resolve(projectRoot, 'src', 'lib', 'evidence', 'snapshot.ts');

function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;

    const eqIndex = token.indexOf('=');
    if (eqIndex !== -1) {
      const key = token.slice(2, eqIndex);
      args[key] = token.slice(eqIndex + 1);
      continue;
    }

    const key = token.slice(2);
    if (key === 'dry-run') {
      args['dry-run'] = true;
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i += 1;
      continue;
    }

    args[key] = true;
  }

  return args;
}

function createGithubHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'hypertrophy-app-evidence-importer',
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  return headers;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: createGithubHeaders() });
  if (!response.ok) {
    throw new Error(`GitHub request failed (${response.status}) for ${url}`);
  }

  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, { headers: createGithubHeaders() });
  if (!response.ok) {
    throw new Error(`GitHub request failed (${response.status}) for ${url}`);
  }

  return response.text();
}

function extractUrls(text) {
  const matches = text.match(/https?:\/\/[^\s)]+/g) || [];
  return [...new Set(matches.map((url) => url.replace(/[.,;:]$/, '')))].filter(Boolean);
}

function stripMarkdown(value) {
  return value
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/[`*_>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}

function extractLabelValue(blockText, label) {
  const pattern = new RegExp(`(?:\\*\\*)?${label}:(?:\\*\\*)?\\s*(.+)`, 'i');
  const match = blockText.match(pattern);
  if (!match) return null;
  return stripMarkdown(match[1]);
}

function inferConfidence(blockText, fallback) {
  if (/needs full read/i.test(blockText)) return 'speculative';
  if (/status:\s*provisional/i.test(blockText)) return 'emerging';
  return fallback;
}

function inferDomain(defaultDomain, text) {
  const lower = text.toLowerCase();
  if (lower.includes('frequency') || lower.includes('session cap')) return 'frequency';
  if (
    lower.includes('progression') ||
    lower.includes('progressive overload') ||
    lower.includes('double progression') ||
    lower.includes('deload')
  ) {
    return 'progression';
  }
  if (lower.includes('recovery') || lower.includes('fatigue')) return 'recovery';
  if (lower.includes('rom') || lower.includes('long length') || lower.includes('stretch')) return 'rom';
  if (lower.includes('exercise') || lower.includes('leverage') || lower.includes('activation')) {
    return 'exercise_selection';
  }
  return defaultDomain;
}

function buildRuleId(prefix, statement, seenIds) {
  const base = `${prefix}-${slugify(statement || 'rule')}`;
  let candidate = base;
  let counter = 2;

  while (seenIds.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }

  seenIds.add(candidate);
  return candidate;
}

function parseRuleBlocks(markdown, options) {
  const { headerPattern, defaultDomain, defaultConfidence, idPrefix } = options;
  const lines = markdown.split(/\r?\n/);
  const blocks = [];
  let current = null;

  for (const line of lines) {
    const headerMatch = line.match(headerPattern);
    if (headerMatch) {
      if (current) blocks.push(current);
      current = {
        title: stripMarkdown(headerMatch[1] || ''),
        lines: [],
      };
      continue;
    }

    if (current) current.lines.push(line);
  }

  if (current) blocks.push(current);

  const fallbackUrls = extractUrls(markdown);
  const seenIds = new Set();

  return blocks
    .map((block) => {
      const blockText = block.lines.join('\n');
      const statement =
        extractLabelValue(blockText, 'Rule') ||
        block.title ||
        'Apply evidence-based hypertrophy training guidance.';
      const rationale =
        extractLabelValue(blockText, 'Rationale') ||
        'Derived from curated hypertrophy research synthesis and coaching interpretation.';
      const sources = extractUrls(blockText);
      const finalSources = sources.length > 0 ? sources : fallbackUrls.slice(0, 2);

      return {
        id: buildRuleId(idPrefix, statement, seenIds),
        domain: inferDomain(defaultDomain, `${block.title} ${statement}`),
        statement,
        rationale,
        confidence: inferConfidence(blockText, defaultConfidence),
        sources: finalSources,
      };
    })
    .filter((rule) => rule.sources.length > 0);
}

function validateSnapshot(snapshot) {
  if (!snapshot.rules.length) {
    throw new Error('Snapshot has no evidence rules.');
  }

  for (const rule of snapshot.rules) {
    if (!rule.sources || rule.sources.length === 0) {
      throw new Error(`Rule ${rule.id} has no sources.`);
    }
  }

  const duplicateRuleIds = snapshot.rules
    .map((rule) => rule.id)
    .filter((id, index, arr) => arr.indexOf(id) !== index);
  if (duplicateRuleIds.length > 0) {
    throw new Error(`Duplicate rule ids detected: ${duplicateRuleIds.join(', ')}`);
  }
}

function renderSnapshotTs(snapshot) {
  return [
    "import type { EvidenceSnapshot } from './types';",
    '',
    `export const beardsleyEvidenceSnapshot: EvidenceSnapshot = ${JSON.stringify(snapshot, null, 2)};`,
    '',
  ].join('\n');
}

/** The reference notes from a local checkout of the notes repository: `--from <its folder>`. */
async function loadLocalReferences(config) {
  const root = path.resolve(process.cwd(), config.from);
  const head = (await fs.readFile(path.join(root, '.git', 'HEAD'), 'utf8')).trim();
  const commitSha = head.startsWith('ref: ')
    ? (await fs.readFile(path.join(root, '.git', head.slice(5)), 'utf8')).trim()
    : head;
  const readReference = (fileName) => fs.readFile(path.join(root, config.referencesPath, fileName), 'utf8');
  const [volumeCanon, exerciseCanon, romCanon] = await Promise.all([
    readReference(REFERENCE_FILES.volumeCanon),
    readReference(REFERENCE_FILES.exerciseCanon),
    readReference(REFERENCE_FILES.romCanon),
  ]);
  return { commitSha, files: { volumeCanon, exerciseCanon, romCanon } };
}

async function loadReferences(config) {
  if (config.from) return loadLocalReferences(config);

  const baseApi = `https://api.github.com/repos/${config.owner}/${config.repo}`;
  const [commit, entries] = await Promise.all([
    fetchJson(`${baseApi}/commits/${config.ref}`),
    fetchJson(`${baseApi}/contents/${config.referencesPath}?ref=${config.ref}`),
  ]);

  const files = new Map(entries.filter((entry) => entry.type === 'file').map((entry) => [entry.name, entry]));

  async function readReference(fileName) {
    const entry = files.get(fileName);
    if (!entry || !entry.download_url) {
      throw new Error(`Reference file not found: ${fileName}`);
    }
    return fetchText(entry.download_url);
  }

  const [volumeCanon, exerciseCanon, romCanon] = await Promise.all([
    readReference(REFERENCE_FILES.volumeCanon),
    readReference(REFERENCE_FILES.exerciseCanon),
    readReference(REFERENCE_FILES.romCanon),
  ]);

  return {
    commitSha: commit.sha,
    files: { volumeCanon, exerciseCanon, romCanon },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const owner = args.owner || DEFAULT_OWNER;
  const repo = args.repo || DEFAULT_REPO;
  const ref = args.ref || DEFAULT_REF;
  const referencesPath = args.path || DEFAULT_REFERENCES_PATH;
  const outPath = args.out ? path.resolve(process.cwd(), String(args.out)) : defaultOutPath;
  const dryRun = Boolean(args['dry-run']);

  const from = typeof args.from === 'string' ? args.from : null;

  const { commitSha, files } = await loadReferences({ owner, repo, ref, referencesPath, from });

  const volumeRules = parseRuleBlocks(files.volumeCanon, {
    headerPattern: /^###\s+Rule\s+\d+\s+[-\u2013\u2014]\s+(.+)$/,
    defaultDomain: 'volume',
    defaultConfidence: 'solid',
    idPrefix: 'volume',
  });

  const exerciseRules = parseRuleBlocks(files.exerciseCanon, {
    headerPattern: /^###\s+Rule\s+\d+\s+[-\u2013\u2014]\s+(.+)$/,
    defaultDomain: 'exercise_selection',
    defaultConfidence: 'solid',
    idPrefix: 'selection',
  });

  const romRules = parseRuleBlocks(files.romCanon, {
    headerPattern: /^\*\*Rule\s+\d+\s+[-\u2013\u2014]\s+(.+)\*\*$/,
    defaultDomain: 'rom',
    defaultConfidence: 'emerging',
    idPrefix: 'rom',
  });

  const allRules = [...volumeRules, ...exerciseRules, ...romRules];

  const now = new Date();
  const snapshot = {
    version: `${now.toISOString().slice(0, 10).replace(/-/g, '.')}-${commitSha.slice(0, 7)}`,
    imported_at: now.toISOString(),
    source_repo: `https://github.com/${owner}/${repo}`,
    source_ref: `${ref}/${referencesPath}@${commitSha.slice(0, 12)}`,
    parser_version: PARSER_VERSION,
    rules: allRules,
  };

  validateSnapshot(snapshot);
  const fileContents = renderSnapshotTs(snapshot);

  if (dryRun) {
    process.stdout.write(fileContents);
    return;
  }

  await fs.writeFile(outPath, fileContents, 'utf8');
  process.stdout.write(
    [
      `Updated snapshot: ${outPath}`,
      `Source: https://github.com/${owner}/${repo}/tree/${ref}/${referencesPath}`,
      `Commit: ${commitSha}`,
      `Rules imported: ${allRules.length}`,
    ].join('\n') + '\n'
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
