#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_OWNER = 'staylan488-ux';
const DEFAULT_REPO = 'hypertrophy-coach';
const DEFAULT_REF = 'main';
const DEFAULT_REFERENCES_PATH = 'references';
const PARSER_VERSION = 'v0.2-auto-import';

const REFERENCE_FILES = {
  volumeCanon: 'beardsley-canon-volume-frequency-progression.md',
  exerciseCanon: 'beardsley-canon-exercise-selection.md',
  romCanon: 'beardsley-canon-long-lengths-rom.md',
  exerciseLibrary: 'exercise-library.md',
  templateUpperLower: 'templates-upper-lower-v1.md',
};

const GENERIC_EXERCISE_TERMS = new Set([
  'press',
  'incline',
  'isolation',
  'vertical',
  'horizontal',
  'seated',
  'standing',
]);

function inferSkillDemand(exerciseName) {
  const lower = exerciseName.toLowerCase();

  if (
    lower.includes('barbell') ||
    lower.includes('squat') ||
    lower.includes('deadlift') ||
    lower.includes('clean') ||
    lower.includes('snatch') ||
    lower.includes('overhead press') ||
    lower.includes('pull-up')
  ) {
    return 'high';
  }

  if (
    lower.includes('dumbbell') ||
    lower.includes('split squat') ||
    lower.includes('lunge') ||
    lower.includes('row') ||
    lower.includes('bench')
  ) {
    return 'medium';
  }

  if (
    lower.includes('machine') ||
    lower.includes('cable') ||
    lower.includes('extension') ||
    lower.includes('curl') ||
    lower.includes('raise') ||
    lower.includes('pushdown') ||
    lower.includes('pulldown')
  ) {
    return 'low';
  }

  return 'medium';
}

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

function parseExerciseNames(rawValue) {
  let normalized = stripMarkdown(rawValue);
  if (!normalized) return [];

  if (/^reference:/i.test(normalized)) return [];
  if (/^if /i.test(normalized) || /^default priority/i.test(normalized)) return [];

  const colonIndex = normalized.indexOf(':');
  if (colonIndex !== -1 && colonIndex < 20) {
    normalized = normalized.slice(colonIndex + 1);
  }

  normalized = normalized.replace(/\([^)]*\)/g, '');

  return normalized
    .split('/')
    .map((item) => item.trim())
    .filter((item) => item.length >= 3 && item.length <= 40)
    .filter((item) => !/^and$/i.test(item))
    .filter((item) => !GENERIC_EXERCISE_TERMS.has(item.toLowerCase()))
    .map((item) => item.replace(/\s+/g, ' '));
}

function parseExerciseLibrary(markdown) {
  const sectionToMuscle = {
    Chest: { primary: 'chest' },
    'Back / lats': { primary: 'back' },
    Delts: { primary: 'shoulders' },
    Quads: { primary: 'quads' },
    'Hamstrings / glutes': { primary: 'hamstrings', secondary: 'glutes' },
    Arms: { primary: 'biceps', secondary: 'triceps' },
    'Calves / abs': { primary: 'calves' },
  };

  const profiles = [];
  const seen = new Set();
  const lines = markdown.split(/\r?\n/);
  let activeSection = null;
  let parseBullets = false;

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      activeSection = sectionToMuscle[h2Match[1].trim()] || null;
      parseBullets = Boolean(activeSection);
      continue;
    }

    if (line.startsWith('### ')) {
      parseBullets = false;
      continue;
    }

    const bulletMatch = line.match(/^-\s+(.+)$/);
    if (!parseBullets || !bulletMatch || !activeSection) continue;

    const names = parseExerciseNames(bulletMatch[1]);
    for (const name of names) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      profiles.push({
        name,
        primary_muscle: activeSection.primary,
        secondary_muscle: activeSection.secondary,
        skill_demand: inferSkillDemand(name),
        stability: 'medium',
        fatigue_cost: 'medium',
        long_length_bias: false,
        substitutions: [],
      });
    }
  }

  return profiles;
}

function buildAnchorProfiles() {
  return [
    {
      name: 'Barbell Back Squat',
      primary_muscle: 'quads',
      secondary_muscle: 'glutes',
      skill_demand: 'high',
      stability: 'medium',
      fatigue_cost: 'high',
      long_length_bias: true,
      substitutions: ['Leg Press', 'Bulgarian Split Squat'],
    },
    {
      name: 'Romanian Deadlift',
      primary_muscle: 'hamstrings',
      secondary_muscle: 'glutes',
      skill_demand: 'high',
      stability: 'medium',
      fatigue_cost: 'high',
      long_length_bias: true,
      substitutions: ['Leg Curl', 'Seated Leg Curl'],
    },
    {
      name: 'Leg Press',
      primary_muscle: 'quads',
      secondary_muscle: 'glutes',
      skill_demand: 'low',
      stability: 'high',
      fatigue_cost: 'medium',
      long_length_bias: true,
      substitutions: ['Barbell Back Squat', 'Bulgarian Split Squat'],
    },
    {
      name: 'Leg Extension',
      primary_muscle: 'quads',
      skill_demand: 'low',
      stability: 'high',
      fatigue_cost: 'low',
      long_length_bias: false,
      substitutions: ['Bulgarian Split Squat', 'Leg Press'],
    },
    {
      name: 'Bulgarian Split Squat',
      primary_muscle: 'quads',
      secondary_muscle: 'glutes',
      skill_demand: 'medium',
      stability: 'low',
      fatigue_cost: 'high',
      long_length_bias: true,
      substitutions: ['Leg Press', 'Barbell Back Squat'],
    },
    {
      name: 'Flat Barbell Bench Press',
      primary_muscle: 'chest',
      secondary_muscle: 'triceps',
      skill_demand: 'high',
      stability: 'medium',
      fatigue_cost: 'high',
      long_length_bias: false,
      substitutions: ['Incline Dumbbell Bench Press', 'Machine Chest Press'],
    },
    {
      name: 'Overhead Barbell Press',
      primary_muscle: 'shoulders',
      secondary_muscle: 'triceps',
      skill_demand: 'high',
      stability: 'medium',
      fatigue_cost: 'high',
      long_length_bias: false,
      substitutions: ['Machine Shoulder Press', 'Dumbbell Shoulder Press'],
    },
    {
      name: 'Seated Cable Row',
      primary_muscle: 'back',
      secondary_muscle: 'biceps',
      skill_demand: 'low',
      stability: 'high',
      fatigue_cost: 'medium',
      long_length_bias: false,
      substitutions: ['Barbell Row', 'Single Arm Cable Row'],
    },
  ];
}

function mergeProfiles(parsedProfiles, anchorProfiles) {
  const byName = new Map();

  for (const profile of [...parsedProfiles, ...anchorProfiles]) {
    const key = profile.name.toLowerCase();
    if (!byName.has(key)) {
      byName.set(key, profile);
    }
  }

  return [...byName.values()];
}

function pickRuleIds(rules, domains) {
  const ids = [];
  for (const domain of domains) {
    const candidates = rules.filter((rule) => rule.domain === domain).slice(0, 2).map((rule) => rule.id);
    ids.push(...candidates);
  }

  return [...new Set(ids)];
}

function buildTemplateBlueprints(rules, _templateMarkdown) {
  const baselineRuleIds = pickRuleIds(rules, ['volume', 'frequency', 'exercise_selection', 'progression']);
  const specializationRuleIds = pickRuleIds(rules, [
    'volume',
    'frequency',
    'exercise_selection',
    'rom',
    'progression',
  ]);

  const templates = [
    {
      id: 'upper-lower-4-evidence-v2',
      name: 'Evidence Upper/Lower (4 days)',
      description: 'Balanced 4-day split with twice-weekly exposure per muscle and controlled per-session fatigue.',
      days_per_week: 4,
      confidence: 'solid',
      focus_muscles: [],
      public_note:
        'General baseline from evidence synthesis: quality hard sets, frequency to distribute volume, and compound-first sequencing.',
      rules: baselineRuleIds,
      days: [
        {
          day_name: 'Lower A',
          muscle_groups: ['quads', 'hamstrings', 'glutes', 'calves'],
          exercises: [
            { name: 'Barbell Back Squat', sets: 3, reps_min: 5, reps_max: 8 },
            { name: 'Romanian Deadlift', sets: 3, reps_min: 6, reps_max: 10 },
            { name: 'Leg Press', sets: 2, reps_min: 8, reps_max: 12 },
            { name: 'Leg Curl', sets: 2, reps_min: 10, reps_max: 15 },
            { name: 'Calf Raise', sets: 3, reps_min: 10, reps_max: 15 },
          ],
        },
        {
          day_name: 'Upper A',
          muscle_groups: ['chest', 'back', 'shoulders', 'biceps', 'triceps'],
          exercises: [
            { name: 'Flat Barbell Bench Press', sets: 3, reps_min: 6, reps_max: 10 },
            { name: 'Seated Cable Row', sets: 3, reps_min: 8, reps_max: 12 },
            { name: 'Lat Pulldown', sets: 2, reps_min: 8, reps_max: 12 },
            { name: 'Lateral Raise', sets: 2, reps_min: 12, reps_max: 20 },
            { name: 'Tricep Pushdown', sets: 2, reps_min: 10, reps_max: 15 },
            { name: 'Dumbbell Curl', sets: 2, reps_min: 10, reps_max: 15 },
          ],
        },
        {
          day_name: 'Lower B',
          muscle_groups: ['quads', 'hamstrings', 'glutes', 'calves'],
          exercises: [
            { name: 'Bulgarian Split Squat', sets: 3, reps_min: 8, reps_max: 12 },
            { name: 'Hip Thrust', sets: 3, reps_min: 8, reps_max: 12 },
            { name: 'Lying Leg Curl', sets: 2, reps_min: 10, reps_max: 15 },
            { name: 'Leg Extension', sets: 2, reps_min: 10, reps_max: 15 },
            { name: 'Standing Calf Raise', sets: 3, reps_min: 12, reps_max: 20 },
          ],
        },
        {
          day_name: 'Upper B',
          muscle_groups: ['chest', 'back', 'shoulders', 'biceps', 'triceps'],
          exercises: [
            { name: 'Overhead Barbell Press', sets: 3, reps_min: 6, reps_max: 10 },
            { name: 'Pull-Up', sets: 3, reps_min: 6, reps_max: 10 },
            { name: 'Incline Dumbbell Bench Press', sets: 2, reps_min: 8, reps_max: 12 },
            { name: 'Barbell Row', sets: 2, reps_min: 6, reps_max: 10 },
            { name: 'Rear Delt Fly', sets: 2, reps_min: 12, reps_max: 20 },
            { name: 'Overhead Tricep Extension', sets: 2, reps_min: 10, reps_max: 15 },
            { name: 'Hammer Curl', sets: 2, reps_min: 10, reps_max: 15 },
          ],
        },
      ],
    },
  ];

  templates.push({
      id: 'upper-lower-4-evidence-upper-focus-v1',
      name: 'Evidence Upper/Lower (4 days, Upper Focus)',
      description:
        'Optional specialization variant that increases upper-body workload while keeping lower-body maintenance volume.',
      days_per_week: 4,
      confidence: 'emerging',
      focus_muscles: ['chest', 'back', 'shoulders', 'biceps', 'triceps'],
      public_note:
        'Specialization variant for users intentionally prioritizing upper body. Not the default recommendation.',
      rules: specializationRuleIds,
      days: [
        {
          day_name: 'Lower A',
          muscle_groups: ['quads', 'hamstrings', 'glutes', 'calves'],
          exercises: [
            { name: 'Barbell Back Squat', sets: 2, reps_min: 5, reps_max: 8 },
            { name: 'Romanian Deadlift', sets: 2, reps_min: 6, reps_max: 10 },
            { name: 'Leg Press', sets: 2, reps_min: 8, reps_max: 12 },
            { name: 'Calf Raise', sets: 2, reps_min: 10, reps_max: 15 },
          ],
        },
        {
          day_name: 'Upper A',
          muscle_groups: ['chest', 'back', 'shoulders', 'biceps', 'triceps'],
          exercises: [
            { name: 'Flat Barbell Bench Press', sets: 4, reps_min: 6, reps_max: 10 },
            { name: 'Seated Cable Row', sets: 4, reps_min: 8, reps_max: 12 },
            { name: 'Lat Pulldown', sets: 3, reps_min: 8, reps_max: 12 },
            { name: 'Lateral Raise', sets: 3, reps_min: 12, reps_max: 20 },
            { name: 'Tricep Pushdown', sets: 3, reps_min: 10, reps_max: 15 },
            { name: 'Dumbbell Curl', sets: 3, reps_min: 10, reps_max: 15 },
          ],
        },
        {
          day_name: 'Lower B',
          muscle_groups: ['quads', 'hamstrings', 'glutes', 'calves'],
          exercises: [
            { name: 'Bulgarian Split Squat', sets: 2, reps_min: 8, reps_max: 12 },
            { name: 'Lying Leg Curl', sets: 2, reps_min: 10, reps_max: 15 },
            { name: 'Standing Calf Raise', sets: 2, reps_min: 12, reps_max: 20 },
          ],
        },
        {
          day_name: 'Upper B',
          muscle_groups: ['chest', 'back', 'shoulders', 'biceps', 'triceps'],
          exercises: [
            { name: 'Overhead Barbell Press', sets: 4, reps_min: 6, reps_max: 10 },
            { name: 'Pull-Up', sets: 4, reps_min: 6, reps_max: 10 },
            { name: 'Barbell Row', sets: 3, reps_min: 6, reps_max: 10 },
            { name: 'Rear Delt Fly', sets: 3, reps_min: 12, reps_max: 20 },
            { name: 'Overhead Tricep Extension', sets: 3, reps_min: 10, reps_max: 15 },
            { name: 'Hammer Curl', sets: 3, reps_min: 10, reps_max: 15 },
          ],
        },
      ],
    });

  templates.push({
      id: 'upper-lower-4-evidence-lower-focus-v1',
      name: 'Evidence Upper/Lower (4 days, Lower Focus)',
      description:
        'Optional specialization variant that increases lower-body workload while keeping upper-body maintenance volume.',
      days_per_week: 4,
      confidence: 'emerging',
      focus_muscles: ['quads', 'hamstrings', 'glutes', 'calves'],
      public_note:
        'Specialization variant for users intentionally prioritizing lower body. Not the default recommendation.',
      rules: specializationRuleIds,
      days: [
        {
          day_name: 'Lower A',
          muscle_groups: ['quads', 'hamstrings', 'glutes', 'calves'],
          exercises: [
            { name: 'Barbell Back Squat', sets: 4, reps_min: 5, reps_max: 8 },
            { name: 'Leg Press', sets: 3, reps_min: 8, reps_max: 12 },
            { name: 'Romanian Deadlift', sets: 3, reps_min: 6, reps_max: 10 },
            { name: 'Calf Raise', sets: 4, reps_min: 10, reps_max: 15 },
          ],
        },
        {
          day_name: 'Upper A',
          muscle_groups: ['chest', 'back', 'shoulders', 'biceps', 'triceps'],
          exercises: [
            { name: 'Incline Dumbbell Bench Press', sets: 2, reps_min: 6, reps_max: 10 },
            { name: 'Seated Cable Row', sets: 2, reps_min: 8, reps_max: 12 },
            { name: 'Lateral Raise', sets: 2, reps_min: 12, reps_max: 20 },
            { name: 'Overhead Tricep Extension', sets: 2, reps_min: 10, reps_max: 15 },
          ],
        },
        {
          day_name: 'Lower B',
          muscle_groups: ['quads', 'hamstrings', 'glutes', 'calves'],
          exercises: [
            { name: 'Leg Extension', sets: 4, reps_min: 10, reps_max: 15 },
            { name: 'Bulgarian Split Squat', sets: 4, reps_min: 8, reps_max: 12 },
            { name: 'Seated Leg Curl', sets: 3, reps_min: 10, reps_max: 15 },
            { name: 'Standing Calf Raise', sets: 4, reps_min: 12, reps_max: 20 },
          ],
        },
        {
          day_name: 'Upper B',
          muscle_groups: ['chest', 'back', 'shoulders', 'biceps', 'triceps'],
          exercises: [
            { name: 'Overhead Barbell Press', sets: 2, reps_min: 6, reps_max: 10 },
            { name: 'Pull-Up', sets: 2, reps_min: 6, reps_max: 10 },
            { name: 'Rear Delt Fly', sets: 2, reps_min: 12, reps_max: 20 },
            { name: 'Preacher Curl', sets: 2, reps_min: 8, reps_max: 12 },
            { name: 'Tricep Pushdown', sets: 2, reps_min: 10, reps_max: 15 },
          ],
        },
      ],
    });

  templates.push(
    {
      id: 'ppl-6-evidence-v1',
      name: 'Evidence Push/Pull/Legs (6 days)',
      description: 'High-frequency PPL split that spreads weekly volume to preserve hard-set quality.',
      days_per_week: 6,
      confidence: 'solid',
      focus_muscles: [],
      public_note: 'Designed for high schedule availability and repeatable quality efforts.',
      rules: baselineRuleIds,
      days: [
        {
          day_name: 'Push A',
          muscle_groups: ['chest', 'shoulders', 'triceps'],
          exercises: [
            { name: 'Flat Barbell Bench Press', sets: 3, reps_min: 5, reps_max: 8 },
            { name: 'Incline Dumbbell Bench Press', sets: 2, reps_min: 8, reps_max: 12 },
            { name: 'Overhead Barbell Press', sets: 3, reps_min: 6, reps_max: 10 },
            { name: 'Lateral Raise', sets: 3, reps_min: 12, reps_max: 15 },
            { name: 'Tricep Pushdown', sets: 2, reps_min: 10, reps_max: 15 },
          ],
        },
        {
          day_name: 'Pull A',
          muscle_groups: ['back', 'rear_delts', 'biceps'],
          exercises: [
            { name: 'Barbell Row', sets: 3, reps_min: 6, reps_max: 10 },
            { name: 'Pull-Up', sets: 3, reps_min: 6, reps_max: 10 },
            { name: 'Lat Pulldown', sets: 2, reps_min: 8, reps_max: 12 },
            { name: 'Face Pull', sets: 2, reps_min: 12, reps_max: 15 },
            { name: 'Barbell Curl', sets: 2, reps_min: 8, reps_max: 12 },
          ],
        },
        {
          day_name: 'Legs A',
          muscle_groups: ['quads', 'hamstrings', 'glutes', 'calves'],
          exercises: [
            { name: 'Barbell Back Squat', sets: 3, reps_min: 5, reps_max: 8 },
            { name: 'Romanian Deadlift', sets: 3, reps_min: 8, reps_max: 12 },
            { name: 'Lunge', sets: 2, reps_min: 10, reps_max: 12 },
            { name: 'Leg Extension', sets: 2, reps_min: 12, reps_max: 15 },
            { name: 'Calf Raise', sets: 3, reps_min: 10, reps_max: 15 },
          ],
        },
        {
          day_name: 'Push B',
          muscle_groups: ['chest', 'shoulders', 'triceps'],
          exercises: [
            { name: 'Incline Barbell Bench Press', sets: 3, reps_min: 6, reps_max: 10 },
            { name: 'Flat Dumbbell Bench Press', sets: 2, reps_min: 8, reps_max: 12 },
            { name: 'Arnold Press', sets: 2, reps_min: 8, reps_max: 12 },
            { name: 'Cable Lateral Raise', sets: 3, reps_min: 12, reps_max: 15 },
            { name: 'Overhead Tricep Extension', sets: 2, reps_min: 10, reps_max: 15 },
          ],
        },
        {
          day_name: 'Pull B',
          muscle_groups: ['back', 'rear_delts', 'biceps'],
          exercises: [
            { name: 'One-Arm Dumbbell Row', sets: 3, reps_min: 8, reps_max: 12 },
            { name: 'Chin-Up', sets: 2, reps_min: 6, reps_max: 10 },
            { name: 'Seated Cable Row', sets: 2, reps_min: 8, reps_max: 12 },
            { name: 'Rear Delt Fly', sets: 2, reps_min: 12, reps_max: 15 },
            { name: 'Hammer Curl', sets: 2, reps_min: 10, reps_max: 15 },
          ],
        },
        {
          day_name: 'Legs B',
          muscle_groups: ['quads', 'hamstrings', 'glutes', 'calves'],
          exercises: [
            { name: 'Leg Press', sets: 3, reps_min: 6, reps_max: 10 },
            { name: 'Bulgarian Split Squat', sets: 3, reps_min: 8, reps_max: 12 },
            { name: 'Hip Thrust', sets: 2, reps_min: 8, reps_max: 12 },
            { name: 'Lying Leg Curl', sets: 2, reps_min: 10, reps_max: 15 },
            { name: 'Standing Calf Raise', sets: 3, reps_min: 10, reps_max: 15 },
          ],
        },
      ],
    },
    {
      id: 'ppl-3-evidence-v1',
      name: 'Evidence Push/Pull/Legs (3 days)',
      description: 'Lower-frequency PPL structure for users with limited weekly training days.',
      days_per_week: 3,
      confidence: 'solid',
      focus_muscles: [],
      public_note: 'Prioritizes consistency and progression quality when schedule is constrained.',
      rules: baselineRuleIds,
      days: [
        {
          day_name: 'Push',
          muscle_groups: ['chest', 'shoulders', 'triceps'],
          exercises: [
            { name: 'Flat Barbell Bench Press', sets: 3, reps_min: 5, reps_max: 8 },
            { name: 'Incline Dumbbell Bench Press', sets: 2, reps_min: 8, reps_max: 12 },
            { name: 'Overhead Barbell Press', sets: 3, reps_min: 6, reps_max: 10 },
            { name: 'Lateral Raise', sets: 2, reps_min: 12, reps_max: 15 },
            { name: 'Tricep Pushdown', sets: 2, reps_min: 10, reps_max: 15 },
          ],
        },
        {
          day_name: 'Pull',
          muscle_groups: ['back', 'rear_delts', 'biceps'],
          exercises: [
            { name: 'Barbell Row', sets: 3, reps_min: 6, reps_max: 10 },
            { name: 'Lat Pulldown', sets: 3, reps_min: 8, reps_max: 12 },
            { name: 'Seated Cable Row', sets: 2, reps_min: 8, reps_max: 12 },
            { name: 'Face Pull', sets: 2, reps_min: 12, reps_max: 15 },
            { name: 'Barbell Curl', sets: 2, reps_min: 8, reps_max: 12 },
          ],
        },
        {
          day_name: 'Legs',
          muscle_groups: ['quads', 'hamstrings', 'glutes', 'calves'],
          exercises: [
            { name: 'Barbell Back Squat', sets: 3, reps_min: 5, reps_max: 8 },
            { name: 'Romanian Deadlift', sets: 3, reps_min: 8, reps_max: 12 },
            { name: 'Leg Press', sets: 2, reps_min: 8, reps_max: 12 },
            { name: 'Bulgarian Split Squat', sets: 2, reps_min: 8, reps_max: 12 },
            { name: 'Calf Raise', sets: 3, reps_min: 10, reps_max: 15 },
          ],
        },
      ],
    },
    {
      id: 'arnold-6-evidence-v1',
      name: 'Evidence Arnold Split (6 days)',
      description: 'Antagonist-paired bodybuilding split with high weekly exposure and controlled set quality.',
      days_per_week: 6,
      confidence: 'emerging',
      focus_muscles: [],
      public_note: 'Advanced schedule option; monitor recovery and use deloads when performance trends flatten.',
      rules: specializationRuleIds,
      days: [
        {
          day_name: 'Chest & Back A',
          muscle_groups: ['chest', 'back'],
          exercises: [
            { name: 'Flat Barbell Bench Press', sets: 3, reps_min: 6, reps_max: 10 },
            { name: 'Barbell Row', sets: 3, reps_min: 6, reps_max: 10 },
            { name: 'Incline Dumbbell Bench Press', sets: 2, reps_min: 8, reps_max: 12 },
            { name: 'Lat Pulldown', sets: 2, reps_min: 8, reps_max: 12 },
            { name: 'Cable Fly', sets: 2, reps_min: 12, reps_max: 15 },
          ],
        },
        {
          day_name: 'Shoulders & Arms A',
          muscle_groups: ['shoulders', 'biceps', 'triceps'],
          exercises: [
            { name: 'Overhead Barbell Press', sets: 3, reps_min: 6, reps_max: 10 },
            { name: 'Lateral Raise', sets: 3, reps_min: 12, reps_max: 15 },
            { name: 'Barbell Curl', sets: 3, reps_min: 8, reps_max: 12 },
            { name: 'Close-Grip Bench Press', sets: 3, reps_min: 6, reps_max: 10 },
            { name: 'Tricep Pushdown', sets: 2, reps_min: 10, reps_max: 15 },
          ],
        },
        {
          day_name: 'Legs A',
          muscle_groups: ['quads', 'hamstrings', 'glutes', 'calves'],
          exercises: [
            { name: 'Barbell Back Squat', sets: 3, reps_min: 5, reps_max: 8 },
            { name: 'Romanian Deadlift', sets: 3, reps_min: 8, reps_max: 12 },
            { name: 'Leg Press', sets: 2, reps_min: 8, reps_max: 12 },
            { name: 'Lying Leg Curl', sets: 2, reps_min: 10, reps_max: 15 },
            { name: 'Calf Raise', sets: 3, reps_min: 10, reps_max: 15 },
          ],
        },
        {
          day_name: 'Chest & Back B',
          muscle_groups: ['chest', 'back'],
          exercises: [
            { name: 'Incline Barbell Bench Press', sets: 3, reps_min: 6, reps_max: 10 },
            { name: 'Pull-Up', sets: 3, reps_min: 6, reps_max: 10 },
            { name: 'Flat Dumbbell Bench Press', sets: 2, reps_min: 8, reps_max: 12 },
            { name: 'One-Arm Dumbbell Row', sets: 2, reps_min: 8, reps_max: 12 },
            { name: 'Pec Deck / Machine Fly', sets: 2, reps_min: 12, reps_max: 15 },
          ],
        },
        {
          day_name: 'Shoulders & Arms B',
          muscle_groups: ['shoulders', 'biceps', 'triceps'],
          exercises: [
            { name: 'Arnold Press', sets: 3, reps_min: 8, reps_max: 12 },
            { name: 'Cable Lateral Raise', sets: 3, reps_min: 12, reps_max: 15 },
            { name: 'Preacher Curl', sets: 3, reps_min: 8, reps_max: 12 },
            { name: 'Skull Crushers', sets: 3, reps_min: 8, reps_max: 12 },
            { name: 'Overhead Tricep Extension', sets: 2, reps_min: 10, reps_max: 15 },
          ],
        },
        {
          day_name: 'Legs B',
          muscle_groups: ['quads', 'hamstrings', 'glutes', 'calves'],
          exercises: [
            { name: 'Leg Press', sets: 3, reps_min: 6, reps_max: 10 },
            { name: 'Bulgarian Split Squat', sets: 3, reps_min: 8, reps_max: 12 },
            { name: 'Hip Thrust', sets: 2, reps_min: 8, reps_max: 12 },
            { name: 'Seated Leg Curl', sets: 2, reps_min: 10, reps_max: 15 },
            { name: 'Standing Calf Raise', sets: 3, reps_min: 10, reps_max: 15 },
          ],
        },
      ],
    },
    {
      id: 'full-body-3-evidence-v1',
      name: 'Evidence Full Body (3 days)',
      description: 'Three full-body sessions with frequent stimulation and controlled per-session set caps.',
      days_per_week: 3,
      confidence: 'solid',
      focus_muscles: [],
      public_note: 'Strong baseline for beginners and tight schedules; quality progression takes priority.',
      rules: baselineRuleIds,
      days: [
        {
          day_name: 'Full Body A',
          muscle_groups: ['chest', 'back', 'quads', 'hamstrings', 'shoulders'],
          exercises: [
            { name: 'Barbell Back Squat', sets: 3, reps_min: 5, reps_max: 8 },
            { name: 'Flat Barbell Bench Press', sets: 3, reps_min: 5, reps_max: 8 },
            { name: 'Barbell Row', sets: 2, reps_min: 6, reps_max: 10 },
            { name: 'Romanian Deadlift', sets: 2, reps_min: 8, reps_max: 12 },
            { name: 'Overhead Barbell Press', sets: 2, reps_min: 6, reps_max: 10 },
          ],
        },
        {
          day_name: 'Full Body B',
          muscle_groups: ['chest', 'back', 'quads', 'glutes', 'shoulders'],
          exercises: [
            { name: 'Leg Press', sets: 3, reps_min: 6, reps_max: 10 },
            { name: 'Incline Dumbbell Bench Press', sets: 3, reps_min: 8, reps_max: 12 },
            { name: 'Lat Pulldown', sets: 2, reps_min: 8, reps_max: 12 },
            { name: 'Bulgarian Split Squat', sets: 2, reps_min: 8, reps_max: 12 },
            { name: 'Arnold Press', sets: 2, reps_min: 8, reps_max: 12 },
          ],
        },
        {
          day_name: 'Full Body C',
          muscle_groups: ['chest', 'back', 'quads', 'hamstrings', 'shoulders'],
          exercises: [
            { name: 'Goblet Squat', sets: 3, reps_min: 8, reps_max: 12 },
            { name: 'Flat Dumbbell Bench Press', sets: 3, reps_min: 8, reps_max: 12 },
            { name: 'Pull-Up', sets: 2, reps_min: 6, reps_max: 10 },
            { name: 'Hip Thrust', sets: 2, reps_min: 8, reps_max: 12 },
            { name: 'Lateral Raise', sets: 2, reps_min: 12, reps_max: 15 },
          ],
        },
      ],
    }
  );

  return templates;
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

  if (!snapshot.template_blueprints.length) {
    throw new Error('Snapshot has no template blueprints.');
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

async function loadReferences(config) {
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

  const [volumeCanon, exerciseCanon, romCanon, exerciseLibrary, templateUpperLower] = await Promise.all([
    readReference(REFERENCE_FILES.volumeCanon),
    readReference(REFERENCE_FILES.exerciseCanon),
    readReference(REFERENCE_FILES.romCanon),
    readReference(REFERENCE_FILES.exerciseLibrary),
    readReference(REFERENCE_FILES.templateUpperLower),
  ]);

  return {
    commitSha: commit.sha,
    files: {
      volumeCanon,
      exerciseCanon,
      romCanon,
      exerciseLibrary,
      templateUpperLower,
    },
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

  const { commitSha, files } = await loadReferences({ owner, repo, ref, referencesPath });

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

  const parsedProfiles = parseExerciseLibrary(files.exerciseLibrary);
  const exerciseProfiles = mergeProfiles(parsedProfiles, buildAnchorProfiles());
  const templateBlueprints = buildTemplateBlueprints(allRules, files.templateUpperLower);

  const now = new Date();
  const snapshot = {
    version: `${now.toISOString().slice(0, 10).replace(/-/g, '.')}-${commitSha.slice(0, 7)}`,
    imported_at: now.toISOString(),
    source_repo: `https://github.com/${owner}/${repo}`,
    source_ref: `${ref}/${referencesPath}@${commitSha.slice(0, 12)}`,
    parser_version: PARSER_VERSION,
    rules: allRules,
    exercise_profiles: exerciseProfiles,
    template_blueprints: templateBlueprints,
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
      `Exercise profiles imported: ${exerciseProfiles.length}`,
      `Templates generated: ${templateBlueprints.length}`,
    ].join('\n') + '\n'
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
