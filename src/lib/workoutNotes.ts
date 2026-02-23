export interface WorkoutNotesPayload {
  movementNotes?: Record<string, string>;
  legacyNote?: string;
}

export function sanitizeMovementNotes(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object') return {};

  const next: Record<string, string> = {};

  for (const [exerciseId, noteValue] of Object.entries(input as Record<string, unknown>)) {
    if (typeof noteValue !== 'string') continue;
    const trimmed = noteValue.trim();
    if (!trimmed) continue;
    next[exerciseId] = trimmed.slice(0, 200);
  }

  return next;
}

export function parseWorkoutNotes(raw: string | null): { movementNotes: Record<string, string>; legacyNote: string | null } {
  if (!raw) {
    return { movementNotes: {}, legacyNote: null };
  }

  try {
    const parsed = JSON.parse(raw) as WorkoutNotesPayload | Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') {
      return { movementNotes: {}, legacyNote: raw };
    }

    if ('movementNotes' in parsed) {
      const payload = parsed as WorkoutNotesPayload;
      return {
        movementNotes: sanitizeMovementNotes(payload.movementNotes),
        legacyNote: typeof payload.legacyNote === 'string' ? payload.legacyNote : null,
      };
    }

    return { movementNotes: sanitizeMovementNotes(parsed), legacyNote: null };
  } catch {
    return { movementNotes: {}, legacyNote: raw };
  }
}

export function serializeWorkoutNotes(movementNotes: Record<string, string>, legacyNote?: string | null): string {
  const payload: WorkoutNotesPayload = {
    movementNotes: sanitizeMovementNotes(movementNotes),
    legacyNote: typeof legacyNote === 'string' && legacyNote.trim() ? legacyNote : undefined,
  };

  return JSON.stringify(payload);
}
