import {
  DEFAULT_REBOUND_SPRING,
  inverseRubberBand,
  resolveSpring,
  rubberBand,
  stepDecay,
  stepSpring,
  type SpringOptions,
  type SpringPreset,
} from "./physics";

export type ScrollPhase = "idle" | "dragging" | "decelerating" | "springing";
export interface ScrollState {
  /** Offset including signed overscroll. Positive moves toward the end. */
  readonly position: number;
  /** CSS pixels per second. */
  readonly velocity: number;
  readonly max: number;
  readonly overscroll: number;
  readonly phase: ScrollPhase;
}
export interface EngineOptions {
  dimension?: number;
  max?: number;
  coefficient?: number;
  spring?: SpringPreset | SpringOptions;
  /** Edge return, independent of scrollTo animations. Default: response .4s, damping 1. */
  reboundSpring?: SpringPreset | SpringOptions;
  /** Per-millisecond velocity multiplier; normal = .998, fast = .99. */
  decelerationRate?: number;
  /** Disable edge stretching while retaining normal scrolling. */
  bounce?: boolean;
}
export const clamp = (x: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, x));
const REST_DISTANCE = 0.1;
const REST_VELOCITY = 2;

/** Deterministic scroll state machine. No browser globals or internal timers. */
export class ScrollEngine {
  private position = 0;
  private velocity = 0;
  private phase: ScrollPhase = "idle";
  private dimension: number;
  private max: number;
  private raw = 0;
  private target = 0;
  private coefficient: number;
  private spring: SpringOptions;
  private reboundSpring: SpringOptions;
  private activeSpring: SpringOptions;
  private rate: number;
  private bounce: boolean;

  constructor(options: EngineOptions = {}) {
    this.dimension = options.dimension ?? 1;
    this.max = options.max ?? 0;
    this.coefficient = options.coefficient ?? 0.55;
    this.spring = resolveSpring(options.spring);
    this.reboundSpring = resolveSpring(
      options.reboundSpring ?? DEFAULT_REBOUND_SPRING,
    );
    this.activeSpring = this.spring;
    this.rate = options.decelerationRate ?? 0.998;
    this.bounce = options.bounce ?? true;
    if (
      ![this.dimension, this.max, this.coefficient, this.rate].every(
        Number.isFinite,
      ) ||
      this.dimension < 0 ||
      this.max < 0 ||
      this.coefficient < 0 ||
      this.rate <= 0 ||
      this.rate >= 1
    ) {
      throw new RangeError(
        "Invalid scroll dimensions, coefficient or decelerationRate.",
      );
    }
  }

  get state(): ScrollState {
    return {
      position: this.position,
      velocity: this.velocity,
      max: this.max,
      overscroll: this.position - clamp(this.position, 0, this.max),
      phase: this.phase,
    };
  }

  setBounds(dimension: number, max: number): void {
    if (
      !Number.isFinite(dimension) ||
      !Number.isFinite(max) ||
      dimension < 0 ||
      max < 0
    ) {
      throw new RangeError("Bounds must be finite and nonnegative.");
    }
    if (dimension === this.dimension && max === this.max) return;
    this.dimension = dimension;
    this.max = max;
    // A resize must not leave a stale target or a drag anchor outside the new bounds.
    this.jumpTo(clamp(this.position, 0, max));
  }

  begin(coefficient = this.coefficient): void {
    if (!Number.isFinite(coefficient) || coefficient < 0)
      throw new RangeError("Invalid coefficient.");
    this.coefficient = coefficient;
    const edge = clamp(this.position, 0, this.max);
    const over = this.position - edge;
    this.raw =
      edge +
      (over && coefficient > 0 && Math.abs(over) < this.dimension
        ? inverseRubberBand(over, this.dimension, coefficient)
        : 0);
    this.velocity = 0;
    this.phase = "dragging";
  }

  /** Delta is in scroll coordinates, not finger coordinates; dt is seconds. */
  dragBy(delta: number, dt: number): void {
    if (!Number.isFinite(delta) || !Number.isFinite(dt) || dt < 0)
      throw new RangeError("Invalid drag sample.");
    if (this.phase !== "dragging") this.begin();
    this.raw += delta;
    const before = this.position;
    const edge = clamp(this.raw, 0, this.max);
    this.position = this.bounce
      ? edge + rubberBand(this.raw - edge, this.dimension, this.coefficient)
      : edge;
    if (dt > 0) {
      const instantaneous = clamp((this.position - before) / dt, -12000, 12000);
      // Time-based smoothing makes velocity tracking independent of event frequency.
      const mix = 1 - Math.exp(-dt / 0.04);
      this.velocity += mix * (instantaneous - this.velocity);
    }
  }

  /** Set velocity to zero for a release after a pause or a canceled pointer. */
  release(velocity = this.velocity): void {
    if (!Number.isFinite(velocity))
      throw new RangeError("Velocity must be finite.");
    this.velocity = velocity;
    const edge = clamp(this.position, 0, this.max);
    if (edge !== this.position) {
      this.target = edge;
      this.activeSpring = this.reboundSpring;
      this.phase = "springing";
    } else if (Math.abs(velocity) >= REST_VELOCITY) {
      this.phase = "decelerating";
    } else this.stop();
  }

  jumpTo(position: number): void {
    if (!Number.isFinite(position))
      throw new RangeError("Position must be finite.");
    this.position = clamp(position, 0, this.max);
    this.raw = this.position;
    this.stop();
  }

  /** Preserve current velocity when an animated scroll is retargeted. */
  animateTo(position: number): void {
    if (!Number.isFinite(position))
      throw new RangeError("Position must be finite.");
    this.target = clamp(position, 0, this.max);
    this.activeSpring = this.spring;
    this.phase = "springing";
  }

  stop(): void {
    this.velocity = 0;
    this.phase = "idle";
  }

  step(seconds: number): ScrollState {
    if (!Number.isFinite(seconds) || seconds < 0)
      throw new RangeError("Time must be finite and nonnegative.");
    if (this.phase === "decelerating") {
      const next = stepDecay(this.state, seconds, this.rate);
      const edge = clamp(next.position, 0, this.max);
      if (edge !== next.position) {
        if (!this.bounce) this.jumpTo(edge);
        else {
          // Solve the exact edge-crossing time, then use the remaining time for the spring.
          // This avoids a frame-rate-dependent jump on long frames / background tabs.
          const k = -1000 * Math.log(this.rate);
          const fraction = ((edge - this.position) * k) / this.velocity;
          const hitTime =
            -Math.log1p(-clamp(fraction, 0, 1 - Number.EPSILON)) / k;
          this.velocity *= Math.exp(-k * hitTime);
          this.position = edge;
          this.target = edge;
          this.activeSpring = this.reboundSpring;
          this.phase = "springing";
          this.advanceSpring(Math.max(0, seconds - hitTime));
        }
      } else {
        this.position = next.position;
        this.velocity = next.velocity;
        if (Math.abs(this.velocity) < REST_VELOCITY) this.stop();
      }
    } else if (this.phase === "springing") this.advanceSpring(seconds);
    return this.state;
  }

  private advanceSpring(seconds: number): void {
    const next = stepSpring(
      this.state,
      this.target,
      seconds,
      this.activeSpring,
    );
    this.position = next.position;
    this.velocity = next.velocity;
    if (!this.bounce && (this.position < 0 || this.position > this.max)) {
      this.jumpTo(this.position);
      return;
    }
    if (
      Math.abs(this.position - this.target) < REST_DISTANCE &&
      Math.abs(this.velocity) < REST_VELOCITY
    ) {
      this.position = this.target;
      this.stop();
    }
  }
}
