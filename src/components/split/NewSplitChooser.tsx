import { useMemo, useState } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { PenLine, Wand2 } from 'lucide-react';
import { Button, SegmentedControl } from '@/components/shared';
import { getExerciseLibrary } from '@/lib/exerciseLibrary';
import { splitTemplates } from '@/lib/splitTemplates';
import { blankSplitDraft, templateSplitDraft } from '@/lib/splitDraftSeed';
import { NEW_SPLIT_DRAFT_ID, clearSplitDraft, readSplitDraft, type StoredSplitDraft } from '@/lib/splitDraftStorage';
import {
  buildGuidedTemplate,
  recommendProgramTemplate,
  type EquipmentProfile,
  type ExperienceLevel,
  type ProgramDesignAnswers,
  type ProgramFocus,
  type SessionLength,
} from '@/lib/programDesigner';
import type { DraftSplit } from '@/lib/splitDraft';

const LIBRARY_MAX_AGE_MS = 5 * 60_000;

type Question<K extends keyof ProgramDesignAnswers, T extends string> = {
  key: K;
  label: string;
  options: Array<{ value: T; label: string }>;
};

const DAYS: Question<'daysPerWeek', string> = {
  key: 'daysPerWeek', label: 'Days per week',
  options: ['3', '4', '5', '6'].map((value) => ({ value, label: value })),
};
const FOCUS: Question<'focus', ProgramFocus> = {
  key: 'focus', label: 'Emphasis',
  options: [{ value: 'no_focus', label: 'Balanced' }, { value: 'upper_focus', label: 'Upper' }, { value: 'lower_focus', label: 'Lower' }],
};
const EQUIPMENT: Question<'equipment', EquipmentProfile> = {
  key: 'equipment', label: 'Equipment',
  options: [{ value: 'full_gym', label: 'Full gym' }, { value: 'dumbbell_only', label: 'Dumbbells' }],
};
const SESSION: Question<'sessionLength', SessionLength> = {
  key: 'sessionLength', label: 'Session length',
  options: [{ value: 'short', label: '45 min' }, { value: 'moderate', label: '60 min' }, { value: 'long', label: '75+ min' }],
};
const EXPERIENCE: Question<'experience', ExperienceLevel> = {
  key: 'experience', label: 'Experience',
  options: [{ value: 'beginner', label: 'Beginner' }, { value: 'intermediate', label: 'Intermediate' }, { value: 'advanced', label: 'Advanced' }],
};

const BLANK_DAY_OPTIONS = ['1', '2', '3', '4', '5', '6', '7'].map((value) => ({ value, label: value }));

/**
 * Where a new program starts: the guided recommendation, or blank days. Both
 * only fill the editor; nothing is created until the editor saves.
 */
export function NewSplitChooser({
  userId,
  onSeed,
  onResume,
}: {
  userId: string | null;
  onSeed: (draft: DraftSplit, notice?: string) => void;
  onResume: (stored: StoredSplitDraft) => void;
}) {
  const [stored, setStored] = useState(() => (userId ? readSplitDraft(userId, NEW_SPLIT_DRAFT_ID) : null));
  const [answers, setAnswers] = useState<ProgramDesignAnswers>({
    daysPerWeek: 4,
    focus: 'no_focus',
    equipment: 'full_gym',
    sessionLength: 'moderate',
    experience: 'intermediate',
  });
  const [blankDays, setBlankDays] = useState('4');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guided = useMemo(
    () => buildGuidedTemplate(recommendProgramTemplate(splitTemplates, answers), answers),
    [answers],
  );
  const guidedExercises = guided.days.reduce((sum, day) => sum + day.exercises.length, 0);

  const answer = <K extends keyof ProgramDesignAnswers>(key: K, value: ProgramDesignAnswers[K]) => {
    setAnswers((current) => ({ ...current, [key]: value }));
  };

  const startGuided = async () => {
    setLoading(true);
    setError(null);
    try {
      const library = await getExerciseLibrary({ maxAgeMs: LIBRARY_MAX_AGE_MS });
      const { draft, missing } = templateSplitDraft(guided, library);
      onSeed(draft, missing.length > 0
        ? `Not in your exercise library, so left out: ${missing.join(', ')}.`
        : undefined);
    } catch {
      setError("Couldn't load the exercise library. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pt-1 pb-2 space-y-8">
      <p className="text-editorial max-w-[34ch]">
        Start from a plan or a blank page. You can change every day and set before it is created.
      </p>

      {stored && (
        <div className="border-t border-b border-[var(--color-border)] py-4 space-y-3" role="status">
          <p className="t-body text-[var(--color-text)]">
            Unsaved program{stored.draft.name.trim() ? ` “${stored.draft.name.trim()}”` : ''} · {stored.draft.days.length}{' '}
            {stored.draft.days.length === 1 ? 'day' : 'days'}, from {formatDistanceToNowStrict(stored.savedAt, { addSuffix: true })}.
          </p>
          <div className="flex gap-3">
            <Button
              size="sm"
              variant="secondary"
              className="flex-1"
              onClick={() => {
                if (userId) clearSplitDraft(userId, NEW_SPLIT_DRAFT_ID);
                setStored(null);
              }}
            >
              Discard it
            </Button>
            <Button size="sm" className="flex-1" onClick={() => onResume(stored)}>
              Resume
            </Button>
          </div>
        </div>
      )}

      <section className="space-y-5">
        <div className="flex items-center gap-2.5 pb-3 border-b border-[var(--color-border)]">
          <Wand2 className="w-4 h-4 text-[var(--color-accent)] shrink-0" strokeWidth={1.5} aria-hidden />
          <h3 className="t-heading">Guided</h3>
        </div>

        <ChoiceRow
          question={DAYS}
          value={String(answers.daysPerWeek)}
          onChange={(value) => answer('daysPerWeek', Number(value))}
        />
        <ChoiceRow question={FOCUS} value={answers.focus} onChange={(value) => answer('focus', value)} />
        <ChoiceRow
          question={EQUIPMENT}
          value={answers.equipment === 'dumbbell_only' ? 'dumbbell_only' : 'full_gym'}
          onChange={(value) => answer('equipment', value)}
        />
        <ChoiceRow question={SESSION} value={answers.sessionLength} onChange={(value) => answer('sessionLength', value)} />
        <ChoiceRow question={EXPERIENCE} value={answers.experience} onChange={(value) => answer('experience', value)} />

        <div aria-live="polite">
          <p className="t-heading">{guided.name}</p>
          <p className="t-data-sm text-[var(--color-muted)] mt-1">
            {guided.days.length} days/week · {guidedExercises} exercises
          </p>
        </div>

        {error && <p className="t-caption text-[var(--color-accent)]" role="alert">{error}</p>}

        <Button size="lg" className="w-full" onClick={() => { void startGuided(); }} loading={loading} disabled={loading}>
          Start from this plan
        </Button>
      </section>

      <section className="space-y-5">
        <div className="flex items-center gap-2.5 pb-3 border-b border-[var(--color-border)]">
          <PenLine className="w-4 h-4 text-[var(--color-text-dim)] shrink-0" strokeWidth={1.5} aria-hidden />
          <h3 className="t-heading">Blank</h3>
        </div>
        <ChoiceRow
          question={{ key: 'daysPerWeek', label: 'Training days', options: BLANK_DAY_OPTIONS }}
          value={blankDays}
          onChange={setBlankDays}
        />
        <Button
          size="lg"
          variant="secondary"
          className="w-full"
          disabled={loading}
          onClick={() => onSeed(blankSplitDraft(Number(blankDays)))}
        >
          Start blank
        </Button>
      </section>
    </div>
  );
}

function ChoiceRow<K extends keyof ProgramDesignAnswers, T extends string>({
  question,
  value,
  onChange,
}: {
  question: Question<K, T>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <span className="t-label block mb-2">{question.label}</span>
      <SegmentedControl size="sm" distribution="equal" value={value} onChange={onChange} options={question.options} />
    </div>
  );
}
