import { useMemo, useState } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { Button, SegmentedControl } from '@/components/shared';
import { blankSplitDraft } from '@/lib/splitDraftSeed';
import { NEW_SPLIT_DRAFT_ID, clearSplitDraft, readSplitDraft, type StoredSplitDraft } from '@/lib/splitDraftStorage';
import type { ProgramDesignAnswers } from '@/lib/programDesigner';
import {
  BLANK_DAY_OPTIONS,
  DAYS_QUESTION as DAYS,
  DEFAULT_BLANK_DAYS,
  DEFAULT_PROGRAM_ANSWERS,
  EQUIPMENT_QUESTION as EQUIPMENT,
  EXPERIENCE_QUESTION as EXPERIENCE,
  FOCUS_QUESTION as FOCUS,
  LIBRARY_LOAD_FAILED,
  SESSION_QUESTION as SESSION,
  guidedTemplate,
  seedGuidedDraft,
  templateExerciseCount,
  type ProgramQuestion as Question,
} from '@/lib/programQuestions';
import type { DraftSplit } from '@/lib/splitDraft';

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
  const [answers, setAnswers] = useState<ProgramDesignAnswers>(DEFAULT_PROGRAM_ANSWERS);
  const [blankDays, setBlankDays] = useState(String(DEFAULT_BLANK_DAYS));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guided = useMemo(() => guidedTemplate(answers), [answers]);
  const guidedExercises = templateExerciseCount(guided);

  const answer = <K extends keyof ProgramDesignAnswers>(key: K, value: ProgramDesignAnswers[K]) => {
    setAnswers((current) => ({ ...current, [key]: value }));
  };

  const startGuided = async () => {
    setLoading(true);
    setError(null);
    try {
      const { draft, notice } = await seedGuidedDraft(guided);
      onSeed(draft, notice ?? undefined);
    } catch {
      setError(LIBRARY_LOAD_FAILED);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pt-1 pb-2">
      <p className="metal-note mt-0">
        Start from a plan or a blank page. You can change every day and set before it is created.
      </p>

      {stored && (
        <div className="split-offer space-y-3 mt-6" role="status">
          <p className="text-[15px] leading-[1.4] text-[var(--metal-ink)]">
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

      <section className="metal-section space-y-5">
        <div className="metal-section-head">
          <h3 className="metal-eyebrow">Guided</h3>
          <span className="metal-section-head-right">Five questions</span>
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

        <div aria-live="polite" className="pt-1">
          <p className="metal-sheet-title text-[22px]">{guided.name}</p>
          <p className="metal-row-detail mt-1 tabular-nums">
            {guided.days.length} days/week · {guidedExercises} exercises
          </p>
        </div>

        {error && <p className="metal-flag" role="alert"><span>{error}</span></p>}

        <Button size="lg" className="w-full" onClick={() => { void startGuided(); }} loading={loading} disabled={loading}>
          Start from this plan
        </Button>
      </section>

      <section className="metal-section space-y-5">
        <div className="metal-section-head">
          <h3 className="metal-eyebrow">Blank</h3>
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
