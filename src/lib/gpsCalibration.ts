/**
 * Speed-dependent distance calibration.
 *
 * Measured against ground truth: an interval session on a 400 m track, where
 * every lap is a known 400 m. The raw pipeline was not wrong by a constant
 * factor. It was wrong as a FUNCTION OF SPEED, and in opposite directions:
 *
 *     walking  1.4 m/s   +6.9 %   (+28 m on a 400 m lap)
 *     jogging  3.0 m/s   +1.2 %
 *     running  4.9 m/s   -5.6 %   (-22 m on a 400 m lap)
 *
 * Slow movement over-reads because a 1 Hz step is then comparable to the
 * position noise, and noise only ever adds length. Fast movement under-reads
 * because the smoothing that suppresses that noise also clips genuine motion
 * once the steps get long.
 *
 * The two cancel over a mixed run, which is exactly why this went unnoticed:
 * the twelve calibration laps summed to 4798 m against a true 4800 m, a total
 * error of -0.04 %, while every individual split was wrong by 4 to 9 %. Totals
 * looked perfect; splits and pace did not.
 *
 * Fit on 11 laps (the first was excluded as a GPS warm-up outlier), r^2 = 0.88.
 * Leave-one-out cross-validation cuts mean absolute lap error from 23.9 m to
 * 9.6 m, a 60 % reduction out of sample. As an independent check, applying it
 * to an unrelated road run recorded three weeks EARLIER moved that run from
 * 327 m away from a Strava recording of the same route to 39 m away (0.35 %).
 *
 * Pure - no I/O, no clock reads.
 */

/** error_m per 400 m = SLOPE * v + INTERCEPT. Both from the track regression. */
const ERROR_SLOPE_M_PER_MPS = -15.8039;
const ERROR_INTERCEPT_M = 56.1300;
const CALIBRATION_BASE_M = 400;

/**
 * The regression only saw 1.34-4.88 m/s. Outside that the correction is held at
 * the edge value rather than extrapolated: the linear fit is a local
 * approximation, and continuing it to a standstill would claim a +14 % error at
 * v = 0, where the true answer is that a stationary phone should accumulate
 * nothing at all.
 */
export const CALIBRATED_MIN_MPS = 1.34;
export const CALIBRATED_MAX_MPS = 4.88;

/** Never let the correction do more than this, whatever the inputs. */
const MAX_CORRECTION = 0.12;

/** Fractional error the raw pipeline exhibits at a given speed. */
export function relativeDistanceError(speedMps: number): number {
  if (!Number.isFinite(speedMps)) return 0;
  const v = Math.min(CALIBRATED_MAX_MPS, Math.max(CALIBRATED_MIN_MPS, speedMps));
  return (ERROR_SLOPE_M_PER_MPS * v + ERROR_INTERCEPT_M) / CALIBRATION_BASE_M;
}

/**
 * Corrects one accepted step for the bias at the speed it was travelled.
 *
 * Applied per step rather than per run so that an interval session, where the
 * bias genuinely reverses sign between the fast rep and the walk back, is
 * corrected in both directions instead of being averaged into a wash.
 */
export function calibrateStepM(stepM: number, speedMps: number): number {
  if (!Number.isFinite(stepM) || stepM <= 0) return 0;
  const error = Math.max(-MAX_CORRECTION, Math.min(MAX_CORRECTION, relativeDistanceError(speedMps)));
  return stepM / (1 + error);
}
