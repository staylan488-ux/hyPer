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

/** The research notes as imported by scripts/import-evidence.mjs. A record to read and cite; no app code runs on it. */
export interface EvidenceSnapshot {
  version: string;
  imported_at: string;
  source_repo: string;
  source_ref: string;
  parser_version: string;
  rules: EvidenceRule[];
}
