/**
 * Human hearing is logarithmic, so a slider that maps its position straight to
 * amplitude spends almost all of its travel in the loud range. These helpers
 * put a perceptual taper between the two: the stored value stays raw amplitude
 * (what the audio engine, persistence and the remote API expect) while the
 * slider works in position space.
 */

/** Curve steepness. 3 is the classic "natural taper" for audio faders. */
const VOLUME_CURVE_EXPONENT = 3;

function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(Math.max(value, 0), 1);
}

/** Slider position (0-1) to the amplitude handed to the audio engine. */
export function sliderToGain(position: number): number {
  return clamp01(position) ** VOLUME_CURVE_EXPONENT;
}

/** Stored amplitude back to the matching slider position. */
export function gainToSlider(gain: number): number {
  return clamp01(gain) ** (1 / VOLUME_CURVE_EXPONENT);
}

/** Slider position as a whole percentage for the value label. */
export function formatVolumeLabel(position: number): string {
  return `${Math.round(clamp01(position) * 100)}%`;
}
