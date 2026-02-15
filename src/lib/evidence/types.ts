import type { MuscleGroup, SplitTemplate } from '@/types';

export type EvidenceDomain =
  | 'volume'
  | 'frequency'
  | 'exercise_selection'
  | 'rom'
  | 'progression'
  | 'recovery';

export type EvidenceConfidence = 'solid' | 'emerging' | 'speculative';

export interface EvidenceRule {
  id: string;
  domain: EvidenceDomain;
  statement: string;
  rationale: string;
  confidence: EvidenceConfidence;
  sources: string[];
}

export interface ExerciseProfile {
  name: string;
  primary_muscle: MuscleGroup;
  secondary_muscle?: MuscleGroup;
  skill_demand: 'high' | 'medium' | 'low';
  stability: 'high' | 'medium' | 'low';
  fatigue_cost: 'low' | 'medium' | 'high';
  long_length_bias: boolean;
  substitutions: string[];
}

export interface TemplateExerciseDraft {
  name: string;
  sets: number;
  reps_min: number;
  reps_max: number;
}

export interface TemplateDayDraft {
  day_name: string;
  muscle_groups: MuscleGroup[];
  exercises: TemplateExerciseDraft[];
}

export interface TemplateBlueprint {
  id: string;
  name: string;
  description: string;
  days_per_week: number;
  confidence: EvidenceConfidence;
  public_note: string;
  focus_muscles?: MuscleGroup[];
  rules: string[];
  days: TemplateDayDraft[];
}

export interface EvidenceSnapshot {
  version: string;
  imported_at: string;
  source_repo: string;
  source_ref: string;
  parser_version: string;
  rules: EvidenceRule[];
  exercise_profiles: ExerciseProfile[];
  template_blueprints: TemplateBlueprint[];
}

export interface CompiledEvidenceSet {
  templates: SplitTemplate[];
  rulesById: Record<string, EvidenceRule>;
}
