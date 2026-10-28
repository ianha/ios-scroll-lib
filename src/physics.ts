/** Pure, DOM-free physics. Distances are CSS pixels; time is seconds. */
export const RUBBER_BAND_COEFFICIENTS = Object.freeze({
  touch: 0.55,
  smallTrackpad: 0.715,
  largeTrackpad: 0.17,
  continuousMouse: 0.4,
  highResolutionWheel: 0.17,
  lowResolutionWheel: 0.5,
  mac: 0.075,
});
export type InputType = keyof typeof RUBBER_BAND_COEFFICIENTS;
export const SPRING_PRESETS = Object.freeze({
  smooth: Object.freeze({ response: 0.5, dampingRatio: 1 }),
  snappy: Object.freeze({ response: 0.5, dampingRatio: 0.85 }),
  bouncy: Object.freeze({ response: 0.5, dampingRatio: 0.7 }),
  interactive: Object.freeze({ response: 0.15, dampingRatio: 0.85 }),
});
export interface SpringOptions {
  response: number;
  dampingRatio: number;
}
/** Faster, critically damped return for scroll boundaries. Response is in seconds. */
export const DEFAULT_REBOUND_SPRING = Object.freeze({
  response: 0.4,
  dampingRatio: 1,
});
export type SpringPreset = keyof typeof SPRING_PRESETS;
export interface Motion {
  position: number;
  velocity: number;
}

/** Apple's rational resistance curve, extended symmetrically to negative x. */
export function rubberBand(
  distance: number,
  dimension: number,
  coefficient = 0.55,
): number {
  if (
    !Number.isFinite(distance) ||
    !Number.isFinite(dimension) ||
    !Number.isFinite(coefficient)
  ) {
    throw new RangeError("rubberBand arguments must be finite.");
  }
  if (dimension < 0 || coefficient < 0)
    throw new RangeError("Dimension and coefficient must be nonnegative.");
  if (dimension === 0 || coefficient === 0) return 0;
  const x = Math.abs(distance);
  return (
    Math.sign(distance) *
    dimension *
    (1 - 1 / (1 + (coefficient * x) / dimension))
  );
}

/** Recover raw drag distance when catching an already stretched edge. */
export function inverseRubberBand(
  distance: number,
  dimension: number,
  coefficient = 0.55,
): number {
  if (
    !Number.isFinite(distance) ||
    !Number.isFinite(dimension) ||
    !Number.isFinite(coefficient) ||
    dimension <= 0 ||
    coefficient <= 0 ||
    Math.abs(distance) >= dimension
  ) {
    throw new RangeError(
      "Inverse rubber band requires d > 0, c > 0 and |distance| < d.",
    );
  }
  return (
    (distance * dimension) / (coefficient * (dimension - Math.abs(distance)))
  );
}

export function resolveSpring(
  spring: SpringPreset | SpringOptions = "smooth",
): SpringOptions {
  const value = typeof spring === "string" ? SPRING_PRESETS[spring] : spring;
  if (
    !value ||
    !Number.isFinite(value.response) ||
    value.response <= 0 ||
    !Number.isFinite(value.dampingRatio) ||
    value.dampingRatio <= 0
  ) {
    throw new RangeError(
      "Spring response and dampingRatio must be finite and greater than zero.",
    );
  }
  return { ...value };
}

/** Exact damped oscillator solution, including under-, critical and overdamping.
 * Retarget by passing the current position AND velocity into the next call.
 */
export function stepSpring(
  motion: Motion,
  target: number,
  seconds: number,
  spring: SpringPreset | SpringOptions = "smooth",
): Motion {
  const { response, dampingRatio: z } = resolveSpring(spring);
  if (
    ![motion.position, motion.velocity, target, seconds].every(
      Number.isFinite,
    ) ||
    seconds < 0
  ) {
    throw new RangeError(
      "Spring state and time must be finite; time must be nonnegative.",
    );
  }
  const w = (2 * Math.PI) / response;
  const x = motion.position - target;
  const v = motion.velocity;
  let displacement: number;
  let velocity: number;
  if (Math.abs(z - 1) < 1e-7) {
    const b = v + w * x;
    const decay = Math.exp(-w * seconds);
    displacement = (x + b * seconds) * decay;
    velocity = (v - w * b * seconds) * decay;
  } else if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z);
    const a = z * w;
    const b = (v + a * x) / wd;
    const cos = Math.cos(wd * seconds),
      sin = Math.sin(wd * seconds);
    const decay = Math.exp(-a * seconds);
    displacement = decay * (x * cos + b * sin);
    velocity = decay * ((b * wd - a * x) * cos - (x * wd + a * b) * sin);
  } else {
    const root = Math.sqrt(z * z - 1);
    const r1 = -w / (z + root),
      r2 = -w * (z + root);
    const a = (v - r2 * x) / (r1 - r2),
      b = x - a;
    displacement = a * Math.exp(r1 * seconds) + b * Math.exp(r2 * seconds);
    velocity =
      a * r1 * Math.exp(r1 * seconds) + b * r2 * Math.exp(r2 * seconds);
  }
  return { position: target + displacement, velocity };
}

/** Exponential inertia; rate is the fraction of velocity retained each millisecond. */
export function stepDecay(
  motion: Motion,
  seconds: number,
  rate = 0.998,
): Motion {
  if (
    ![motion.position, motion.velocity, seconds, rate].every(Number.isFinite) ||
    seconds < 0 ||
    rate <= 0 ||
    rate >= 1
  ) {
    throw new RangeError(
      "Decay requires finite state, time >= 0 and 0 < rate < 1.",
    );
  }
  const k = -1000 * Math.log(rate);
  const decay = Math.exp(-k * seconds);
  return {
    position:
      motion.position + (motion.velocity * -Math.expm1(-k * seconds)) / k,
    velocity: motion.velocity * decay,
  };
}
