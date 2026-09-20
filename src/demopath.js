// demopath.js — a scripted "virtual head" for Demo Mode.
// Pure logic, no DOM. Testable in node.
//
// Why this exists: a judge opening the deployed link might be on a machine with
// no webcam, or might (reasonably) decline the camera prompt. Demo Mode makes
// the ENTIRE product explorable with zero hardware: it emits a smooth path of
// normalized "head" positions that visit a list of targets and pause on each
// long enough to trigger a real dwell-click. The rest of the app can't tell the
// difference between this and a live face — it consumes the same {x,y} signal.

/**
 * Ease in-out so motion between targets looks human, not linear.
 */
function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * Build a driver that, given a timestamp, returns a normalized {x,y} in [0,1].
 *
 * @param {Array<{x:number,y:number,hold:number}>} targets
 *        normalized target points and how long (ms) to rest on each.
 * @param {number} travelMs  time to glide between two targets.
 */
export class DemoDriver {
  constructor(targets, { travelMs = 1100 } = {}) {
    if (!targets || targets.length < 2) {
      throw new Error('DemoDriver needs at least 2 targets');
    }
    this.targets = targets;
    this.travelMs = travelMs;
    this.startTime = null;
  }

  /** Total loop duration in ms. */
  loopDuration() {
    // each leg = travel + the destination's hold
    return this.targets.reduce((sum, t) => sum + this.travelMs + (t.hold || 0), 0);
  }

  /**
   * @param {number} now  timestamp in ms
   * @returns {{x:number, y:number, resting:boolean, index:number}}
   */
  sample(now) {
    if (this.startTime == null) this.startTime = now;
    const loop = this.loopDuration();
    let t = (now - this.startTime) % loop;

    // Walk the legs until we find where t lands.
    for (let i = 0; i < this.targets.length; i++) {
      const from = this.targets[i];
      const to = this.targets[(i + 1) % this.targets.length];
      const hold = from.hold || 0;

      // Resting on `from`.
      if (t < hold) {
        return { x: from.x, y: from.y, resting: true, index: i };
      }
      t -= hold;

      // Travelling from -> to.
      if (t < this.travelMs) {
        const k = easeInOut(t / this.travelMs);
        return {
          x: from.x + (to.x - from.x) * k,
          y: from.y + (to.y - from.y) * k,
          resting: false,
          index: i,
        };
      }
      t -= this.travelMs;
    }
    // Fallback (shouldn't hit): last target.
    const last = this.targets[this.targets.length - 1];
    return { x: last.x, y: last.y, resting: true, index: this.targets.length - 1 };
  }

  reset() {
    this.startTime = null;
  }
}
