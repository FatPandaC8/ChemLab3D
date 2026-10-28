/**
 * One Euro filter for noisy interactive signals.
 *
 * At rest it behaves like a low-pass filter with a low cutoff (removes jitter).
 * As a signal's speed increases, the cutoff rises so fast motion is not lagged.
 * See Casiez, Roussel & Vogel, "1€ Filter" (CHI 2012).
 */
export class OneEuroFilter {
  private initialized = false;
  private lastTime = 0;
  private valuePrev = 0;
  private derivativePrev = 0;

  constructor(
    private readonly minCutoff = 2,
    private readonly beta = 0.5,
    private readonly derivativeCutoff = 1,
  ) {}

  filter(value: number, timeMs: number): number {
    if (!Number.isFinite(value)) {
      return this.valuePrev;
    }

    if (!this.initialized) {
      this.initialize(value, timeMs);
      return value;
    }

    const dt = (timeMs - this.lastTime) / 1000;
    // Re-seed after a long gap instead of letting the filter "catch up".
    if (!(dt > 0) || dt > 0.25) {
      this.initialize(value, timeMs);
      return value;
    }

    const derivative = (value - this.valuePrev) / dt;
    const filteredDerivative = lowPass(
      derivative,
      this.derivativePrev,
      alpha(this.derivativeCutoff, dt),
    );
    const cutoff =
      this.minCutoff + this.beta * Math.abs(filteredDerivative);
    const filtered = lowPass(value, this.valuePrev, alpha(cutoff, dt));

    this.valuePrev = filtered;
    this.derivativePrev = filteredDerivative;
    this.lastTime = timeMs;
    return filtered;
  }

  reset(): void {
    this.initialized = false;
  }

  private initialize(value: number, timeMs: number): void {
    this.valuePrev = value;
    this.derivativePrev = 0;
    this.lastTime = timeMs;
    this.initialized = true;
  }
}

function alpha(cutoff: number, dt: number): number {
  const timeConstant = 1 / (2 * Math.PI * Math.max(cutoff, 1e-6));
  return 1 / (1 + timeConstant / dt);
}

function lowPass(value: number, previous: number, alphaValue: number): number {
  return alphaValue * value + (1 - alphaValue) * previous;
}
