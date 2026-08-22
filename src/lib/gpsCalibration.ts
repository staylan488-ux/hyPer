/**
 * GPS differential-noise model.
 *
 * A 1 Hz fix carries a position uncertainty (Core Location's `horizontalAccuracy`)
 * of a few metres, but CONSECUTIVE fixes do not err independently: multipath,
 * ionospheric delay and satellite geometry all drift slowly, so most of the error
 * is common to both endpoints of a step and cancels when they are subtracted.
 *
 * Measured on this run's stationary stretch - 401 samples where the phone was
 * standing still, so all apparent movement is noise - the step-to-step error is
 * about 0.14 of the reported accuracy, not the ~1.4x that independent errors
 * would give. That single number is what makes noise removal tractable.
 *
 * Why it matters: at running pace a 1 Hz step is around 3 m while the reported
 * accuracy is around 3.7 m. Summing raw steps therefore adds noise on every
 * sample, and noise only ever ADDS length. The correction is to remove it in
 * quadrature, which is the standard unbiased estimator for a length measured
 * with additive error:
 *
 *     true_step = sqrt(max(0, measured^2 - sigma^2))
 *
 * This degrades smoothly to zero as movement approaches the noise floor, unlike
 * a hard minimum-step threshold, which credits a step of (floor + epsilon) in
 * full even though almost all of it is noise. That threshold behaviour was the
 * source of the +7% over-read at walking pace.
 */

/**
 * Step-to-step error as a fraction of reported horizontal accuracy.
 *
 * Chosen as the value that independently zeroes the bias at BOTH ends of the
 * speed range on a 400 m track: at 0.14 the fast laps come out -0.0 m and the
 * slow laps +0.1 m against a true 400 m. It was deliberately NOT chosen to
 * minimise mean absolute error, which would have picked 0.11 and left a +8 m
 * over-read on slow laps - a lower average error bought by reintroducing the
 * very bias this is meant to remove.
 */
export const DIFFERENTIAL_NOISE_FRACTION = 0.14;

/**
 * Hard ceiling on the noise removed from a single step, in metres.
 *
 * The fraction above was measured where fixes were 3-4 m accurate, giving a
 * sigma near 0.6 m. Reported accuracy degrades faster than the step-to-step
 * error does, so scaling the fraction into a 10 m fix would remove 1.98 m and
 * erase walking entirely - a phone under tree cover would quietly stop counting
 * distance. The cap never binds in the conditions the fraction was calibrated
 * in; it only bounds the poor-fix tail.
 */
export const MAX_STEP_NOISE_M = 1.0;

/**
 * Removes the expected GPS noise from one measured step.
 *
 * `accuracyM` values are the reported horizontal accuracy of the two fixes the
 * step spans; they are combined in quadrature because each contributes error.
 */
export function denoiseStepM(
  measuredStepM: number,
  previousAccuracyM: number,
  currentAccuracyM: number,
): number {
  if (!Number.isFinite(measuredStepM) || measuredStepM <= 0) return 0;
  const combined = Math.hypot(
    Number.isFinite(previousAccuracyM) ? previousAccuracyM : currentAccuracyM,
    Number.isFinite(currentAccuracyM) ? currentAccuracyM : 0,
  );
  const sigma = Math.min(combined * DIFFERENTIAL_NOISE_FRACTION, MAX_STEP_NOISE_M);
  return Math.sqrt(Math.max(0, measuredStepM * measuredStepM - sigma * sigma));
}
