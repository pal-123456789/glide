// filter.js — signal smoothing for jittery landmark data.
// Pure logic, no DOM: importable in the browser AND testable in node.
//
// Head-tracking landmarks are noisy. If we map them straight to a cursor it
// shakes. A low-pass filter removes shake but adds lag, which feels sluggish.
// The One Euro Filter (Casiet et al., CHI 2012) solves the trade-off: it
// filters hard when you're still (kills jitter) and lightly when you're moving
// fast (kills lag). It's the standard for exactly this problem.

/**
 * A single-value low-pass filter.
 * y_i = a * x_i + (1 - a) * y_{i-1}
 */
export class LowPass {
  constructor() {
    this.hadPrev = false;
    this.prev = 0;
  }
  filter(value, alpha) {
    if (!this.hadPrev) {
      this.hadPrev = true;
      this.prev = value;
      return value;
    }
    const out = alpha * value + (1 - alpha) * this.prev;
    this.prev = out;
    return out;
  }
  last() {
    return this.prev;
  }
  reset() {
    this.hadPrev = false;
    this.prev = 0;
  }
}

/**
 * One Euro Filter for a single scalar channel.
 *
 * @param {object} opts
 * @param {number} opts.minCutoff  Lower = more smoothing when still. Default 1.0 Hz.
 * @param {number} opts.beta       Higher = less lag when moving fast. Default 0.007.
 * @param {number} opts.dCutoff    Cutoff for the derivative. Default 1.0 Hz.
 */
export class OneEuro {
  constructor({ minCutoff = 1.0, beta = 0.007, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xFilt = new LowPass();
    this.dxFilt = new LowPass();
    this.lastTime = null;
  }

  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  /**
   * @param {number} value  raw sample
   * @param {number} timestampMs  monotonically increasing time in ms
   */
  filter(value, timestampMs) {
    if (this.lastTime == null) {
      this.lastTime = timestampMs;
      this.xFilt.filter(value, 1);
      return value;
    }
    let dt = (timestampMs - this.lastTime) / 1000;
    this.lastTime = timestampMs;
    // Guard against zero/negative dt (paused tabs, duplicate timestamps).
    if (!(dt > 0) || !isFinite(dt)) dt = 1 / 60;

    // Derivative of the signal, itself low-passed.
    const prevX = this.xFilt.hadPrev ? this.xFilt.last() : value;
    const dx = (value - prevX) / dt;
    const edx = this.dxFilt.filter(dx, OneEuro.alpha(this.dCutoff, dt));

    // Adaptive cutoff: speed up (raise cutoff) when moving fast.
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.xFilt.filter(value, OneEuro.alpha(cutoff, dt));
  }

  reset() {
    this.xFilt.reset();
    this.dxFilt.reset();
    this.lastTime = null;
  }
}

/** Convenience: a 2D point filter (x and y as independent channels). */
export class OneEuro2D {
  constructor(opts) {
    this.fx = new OneEuro(opts);
    this.fy = new OneEuro(opts);
  }
  filter(x, y, t) {
    return { x: this.fx.filter(x, t), y: this.fy.filter(y, t) };
  }
  setParams({ minCutoff, beta } = {}) {
    for (const f of [this.fx, this.fy]) {
      if (minCutoff != null) f.minCutoff = minCutoff;
      if (beta != null) f.beta = beta;
    }
  }
  reset() {
    this.fx.reset();
    this.fy.reset();
  }
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
