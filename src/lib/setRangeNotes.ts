const SET_RANGE_TAG = '[set-range]';

interface ParsedRangePayload {
  min?: unknown;
  max?: unknown;
}

export interface SetRangeNotesResult {
  minSets: number;
  targetSets: number;
  maxSets: number;
  baseNotes: string | null;
}

function clampSetCount(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(10, Math.round(value)));
}

export function normalizeSetRange(minSets: number, targetSets: number, maxSets: number): Pick<SetRangeNotesResult, 'minSets' | 'targetSets' | 'maxSets'> {
  const safeTarget = clampSetCount(targetSets, 3);
  const safeMinRaw = clampSetCount(minSets, safeTarget);
  const safeMaxRaw = clampSetCount(maxSets, safeTarget);

  const orderedMin = Math.min(safeMinRaw, safeMaxRaw);
  const orderedMax = Math.max(safeMinRaw, safeMaxRaw);
  const orderedTarget = Math.max(orderedMin, Math.min(orderedMax, safeTarget));

  return {
    minSets: orderedMin,
    targetSets: orderedTarget,
    maxSets: orderedMax,
  };
}

function stripTaggedNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;

  const lines = notes
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => !line.trimStart().startsWith(SET_RANGE_TAG));

  const joined = lines.join('\n').trim();
  return joined ? joined : null;
}

export function parseSetRangeNotes(notes: string | null | undefined, targetSets: number): SetRangeNotesResult {
  const normalizedTarget = clampSetCount(targetSets, 3);
  let minSets = normalizedTarget;
  let maxSets = normalizedTarget;

  if (notes) {
    const taggedLine = notes
      .split('\n')
      .find((line) => line.trimStart().startsWith(SET_RANGE_TAG));

    if (taggedLine) {
      const payloadRaw = taggedLine.trimStart().slice(SET_RANGE_TAG.length).trim();
      try {
        const parsed = JSON.parse(payloadRaw) as ParsedRangePayload;
        if (typeof parsed.min === 'number') {
          minSets = parsed.min;
        }
        if (typeof parsed.max === 'number') {
          maxSets = parsed.max;
        }
      } catch {
        // Ignore malformed metadata and fall back to target.
      }
    }
  }

  const normalized = normalizeSetRange(minSets, normalizedTarget, maxSets);
  return {
    ...normalized,
    baseNotes: stripTaggedNotes(notes),
  };
}

export function serializeSetRangeNotes(
  existingNotes: string | null | undefined,
  minSets: number,
  targetSets: number,
  maxSets: number
): string | null {
  const normalized = normalizeSetRange(minSets, targetSets, maxSets);
  const baseNotes = stripTaggedNotes(existingNotes);

  if (normalized.minSets === normalized.targetSets && normalized.maxSets === normalized.targetSets) {
    return baseNotes;
  }

  const metadata = `${SET_RANGE_TAG}${JSON.stringify({
    min: normalized.minSets,
    max: normalized.maxSets,
  })}`;

  if (!baseNotes) return metadata;
  return `${baseNotes}\n${metadata}`;
}
