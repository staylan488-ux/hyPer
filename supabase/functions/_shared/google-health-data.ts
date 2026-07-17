export interface ReconciledWeightPoint {
  dataPointName?: string;
  weight?: {
    sampleTime?: { physicalTime?: string };
    weightGrams?: number;
  };
}

export interface GoogleHealthWeightRow {
  user_id: string;
  measured_at: string;
  weight_kg: number;
  source: 'google_health';
  external_id: string;
  updated_at: string;
}

export function normalizeGoogleHealthWeights(
  points: ReconciledWeightPoint[],
  userId: string,
  updatedAt: string,
): GoogleHealthWeightRow[] {
  return points.flatMap((point) => {
    const measuredAt = point.weight?.sampleTime?.physicalTime;
    const weightGrams = Number(point.weight?.weightGrams);
    if (!measuredAt || !Number.isFinite(weightGrams) || weightGrams <= 0 || weightGrams >= 700_000) return [];

    return [{
      user_id: userId,
      measured_at: measuredAt,
      weight_kg: Math.round(weightGrams) / 1000,
      source: 'google_health' as const,
      external_id: point.dataPointName || `${measuredAt}:${Math.round(weightGrams)}`,
      updated_at: updatedAt,
    }];
  });
}
