import type { SplitTemplate } from '@/types';
import { compileEvidenceTemplates } from '@/lib/evidence/compiler';
import { beardsleyEvidenceSnapshot } from '@/lib/evidence/snapshot';

const compiledEvidence = compileEvidenceTemplates(beardsleyEvidenceSnapshot);

export const splitTemplates: SplitTemplate[] = [...compiledEvidence.templates];

export function getVolumeRecommendation(
  weeklySets: number,
  landmark: { mev: number; mav_low: number; mav_high: number; mrv: number }
): { status: string; message: string } {
  if (weeklySets < landmark.mev) {
    return {
      status: 'below_mev',
      message: `Below minimum effective volume (${weeklySets}/${landmark.mev} sets). Add more sets to stimulate growth.`,
    };
  }

  if (weeklySets < landmark.mav_low) {
    return {
      status: 'mev_mav',
      message: 'In maintenance range. Consider adding sets to optimize hypertrophy.',
    };
  }

  if (weeklySets <= landmark.mav_high) {
    return {
      status: 'mav',
      message: 'Optimal volume range! Keep consistent for best results.',
    };
  }

  if (weeklySets < landmark.mrv) {
    return {
      status: 'approaching_mrv',
      message: 'High volume zone. Monitor fatigue and consider a deload if recovery suffers.',
    };
  }

  return {
    status: 'above_mrv',
    message: 'Exceeding recoverable volume. Reduce sets or take a deload week to prevent overtraining.',
  };
}
