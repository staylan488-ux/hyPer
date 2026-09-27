import type { SplitTemplate } from '@/types';
import { compileEvidenceTemplates } from '@/lib/evidence/compiler';
import { beardsleyEvidenceSnapshot } from '@/lib/evidence/snapshot';

const compiledEvidence = compileEvidenceTemplates(beardsleyEvidenceSnapshot);

export const splitTemplates: SplitTemplate[] = [...compiledEvidence.templates];
