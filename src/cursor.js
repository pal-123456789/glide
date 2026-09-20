// cursor.js — map a normalized head/nose position to screen coordinates.
// Pure logic, no DOM. Testable in node.
//
// MediaPipe gives landmark coords in [0,1] relative to the video frame.
// We can't use them 1:1: a person can only turn their head a little, so a
// small head range must cover the whole screen. We also want:
//   - a dead-zone around center, so resting still doesn't cause drift;
//   - a sensitivity/gain, so users tune how far a movement travels;
//   - edge acceleration, so screen corners are reachable comfortably;
//   - mirroring on X (webcam is mirrored, moving right should go right).

import { clamp } from './filter.js';

/**
 * @param {object} opts
 * @param {number} opts.sensitivity  gain multiplier (0.5 slow … 2.5 fast). Default 1.4
 * @param {number} opts.deadZone     fraction of center to ignore. Default 0.06
 * @param {boolean} opts.mirrorX     flip X (front camera). Default true
 */
export class CursorMapper {
  constructor({ sensitivity = 1.4, deadZone = 0.06, mirrorX = true } = {}) {
    this.sensitivity = sensitivity;
    this.deadZone = deadZone;
    this.mirrorX = mirrorX;
    // The "neutral" head position, set during calibration. Defaults to center.
    this.centerX = 0.5;
    this.centerY = 0.5;
  }

  /** Capture the current head position as the neutral/rest point. */
  calibrate(nx, ny) {
    this.centerX = clamp(nx, 0.2, 0.8);
    this.centerY = clamp(ny, 0.2, 0.8);
  }

  /** Apply a symmetric dead-zone then renormalize so motion is continuous. */
  _applyDeadZone(offset) {
    const dz = this.deadZone;
    if (Math.abs(offset) <= dz) return 0;
    const sign = Math.sign(offset);
    return sign * (Math.abs(offset) - dz) / (1 - dz);
  }

  /**
   * Map a normalized landmark position to screen pixels.
   * @param {number} nx  normalized x in [0,1]
   * @param {number} ny  normalized y in [0,1]
   * @param {number} w   viewport width in px
   * @param {number} h   viewport height in px
   * @returns {{x:number, y:number}}
   */
  toScreen(nx, ny, w, h) {
    // Offset from the calibrated neutral point, in [-0.5, 0.5]-ish.
    let ox = nx - this.centerX;
    let oy = ny - this.centerY;

    if (this.mirrorX) ox = -ox;

    ox = this._applyDeadZone(ox);
    oy = this._applyDeadZone(oy);

    // Edge acceleration: cubic term extends reach near the extremes without
    // making the center twitchy. blended 70% linear / 30% cubic.
    const shape = (v) => 0.7 * v + 0.3 * Math.sign(v) * v * v * 4;

    // Scale so a moderate head turn (~0.18 of frame) reaches the edge at gain 1.
    const span = 0.18 / this.sensitivity;
    let fx = shape(ox / span); // roughly [-1, 1] at the usable extremes
    let fy = shape(oy / span);

    fx = clamp(fx, -1, 1);
    fy = clamp(fy, -1, 1);

    // Map [-1,1] -> [0,w]
    const x = clamp((fx * 0.5 + 0.5) * w, 0, w);
    const y = clamp((fy * 0.5 + 0.5) * h, 0, h);
    return { x, y };
  }

  setSensitivity(s) {
    this.sensitivity = clamp(s, 0.4, 3.0);
  }
}
