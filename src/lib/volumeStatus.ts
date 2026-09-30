import type { MuscleVolume, VolumeLandmark } from '@/types';

export type VolumeThresholds = Pick<VolumeLandmark, 'mev' | 'mav_low' | 'mav_high' | 'mrv'>;

// The single rule for grading weekly sets against a muscle's landmarks. Both
// the status chip and the recommendation caption come from it.
export function classifyVolume(weeklySets: number, landmark: VolumeThresholds): MuscleVolume['status'] {
  if (weeklySets < landmark.mev) return 'below_mev';
  if (weeklySets < landmark.mav_low) return 'mev_mav';
  if (weeklySets <= landmark.mav_high) return 'mav';
  if (weeklySets < landmark.mrv) return 'approaching_mrv';
  return 'above_mrv';
}

export function getVolumeRecommendation(
  weeklySets: number,
  landmark: VolumeThresholds
): { status: MuscleVolume['status']; message: string } {
  const status = classifyVolume(weeklySets, landmark);

  switch (status) {
    case 'below_mev':
      return {
        status,
        message: `Below minimum effective volume (${weeklySets}/${landmark.mev} sets). Add more sets to stimulate growth.`,
      };
    case 'mev_mav':
      return {
        status,
        message: 'In maintenance range. Consider adding sets to optimize hypertrophy.',
      };
    case 'mav':
      return {
        status,
        message: 'Optimal volume range! Keep consistent for best results.',
      };
    case 'approaching_mrv':
      return {
        status,
        message: 'High volume zone. Monitor fatigue and consider a deload if recovery suffers.',
      };
    case 'above_mrv':
      return {
        status,
        message: 'Exceeding recoverable volume. Reduce sets or take a deload week to prevent overtraining.',
      };
  }
}
