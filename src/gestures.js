// gestures.js — turn continuous face signals into discrete actions.
// Pure logic, no DOM. Testable in node.
//
// Two ways to "click" without hands:
//   1. DWELL: hold the cursor still over a target for N ms. A ring fills; when
//      it completes, we fire a click. This is how commercial eye-gaze software
//      works and it's the most reliable for everyone.
//   2. BLINK: a deliberate (long) blink fires a click. Faster for able-blinkers,
//      but we must ignore natural blinks — so we threshold on duration.
//
// Extra actions from expressions (optional, user can disable):
//   - jawOpen  -> "back" / secondary action
//   - browsUp  -> toggle scroll mode
//
// The machine is fed one frame at a time and emits events. It owns all timing
// and debouncing so the UI layer stays dumb.

export const DWELL = 'dwell';
export const BLINK = 'blink';

/**
 * Dwell detector. Tracks how long the pointer has stayed within `moveTolerance`
 * pixels of where it "landed". Emits progress [0..1] and a `click` when full.
 */
export class DwellClicker {
  constructor({ dwellMs = 900, moveTolerance = 45, refractoryMs = 400 } = {}) {
    this.dwellMs = dwellMs;
    this.moveTolerance = moveTolerance;
    this.refractoryMs = refractoryMs;
    this.anchor = null;      // {x,y} where the current dwell started
    this.startTime = 0;
    this.lastClickTime = -1e9;
    this.armed = true;       // must leave a target before it can re-click
  }

  reset() {
    this.anchor = null;
  }

  /**
   * @returns {{progress:number, click:boolean}}
   */
  update(x, y, now) {
    // Refractory: after a click, wait before allowing another.
    if (now - this.lastClickTime < this.refractoryMs) {
      this.anchor = { x, y };
      this.startTime = now;
      return { progress: 0, click: false };
    }

    if (!this.anchor) {
      this.anchor = { x, y };
      this.startTime = now;
      return { progress: 0, click: false };
    }

    const dx = x - this.anchor.x;
    const dy = y - this.anchor.y;
    const moved = Math.hypot(dx, dy);

    if (moved > this.moveTolerance) {
      // Pointer wandered — restart the dwell here.
      this.anchor = { x, y };
      this.startTime = now;
      this.armed = true;
      return { progress: 0, click: false };
    }

    const elapsed = now - this.startTime;
    const progress = Math.min(1, elapsed / this.dwellMs);
    if (progress >= 1 && this.armed) {
      this.armed = false;                 // don't machine-gun clicks
      this.lastClickTime = now;
      this.anchor = { x, y };
      this.startTime = now;
      return { progress: 1, click: true };
    }
    return { progress, click: false };
  }
}

/**
 * Blink detector. MediaPipe blendshapes give eyeBlinkLeft/Right in [0,1].
 * A natural blink is ~100-150ms; we only fire on a *deliberate* blink held
 * beyond `minCloseMs`, and require both eyes (to ignore winks/one-eye noise).
 */
export class BlinkClicker {
  constructor({ closeThresh = 0.5, minCloseMs = 220, maxCloseMs = 1200, refractoryMs = 700 } = {}) {
    this.closeThresh = closeThresh;
    this.minCloseMs = minCloseMs;
    this.maxCloseMs = maxCloseMs;
    this.refractoryMs = refractoryMs;
    this.closedSince = null;
    this.lastClickTime = -1e9;
  }

  reset() {
    this.closedSince = null;
  }

  /**
   * @param {number} blinkL eyeBlinkLeft score [0,1]
   * @param {number} blinkR eyeBlinkRight score [0,1]
   * @returns {{click:boolean, closing:boolean}}
   */
  update(blinkL, blinkR, now) {
    const closed = blinkL > this.closeThresh && blinkR > this.closeThresh;

    if (closed) {
      if (this.closedSince == null) this.closedSince = now;
      return { click: false, closing: true };
    }

    // Eyes just opened — decide if the closure counted as a deliberate blink.
    let click = false;
    if (this.closedSince != null) {
      const dur = now - this.closedSince;
      const longEnough = dur >= this.minCloseMs && dur <= this.maxCloseMs;
      const past = now - this.lastClickTime >= this.refractoryMs;
      if (longEnough && past) {
        click = true;
        this.lastClickTime = now;
      }
      this.closedSince = null;
    }
    return { click, closing: false };
  }
}

/**
 * Rising-edge detector for an expression channel (jawOpen, browInnerUp...).
 * Fires once when the score crosses `thresh` upward, with a refractory period.
 */
export class ExpressionTrigger {
  constructor({ thresh = 0.5, refractoryMs = 800 } = {}) {
    this.thresh = thresh;
    this.refractoryMs = refractoryMs;
    this.wasActive = false;
    this.lastFire = -1e9;
  }
  update(score, now) {
    const active = score > this.thresh;
    let fired = false;
    if (active && !this.wasActive && now - this.lastFire >= this.refractoryMs) {
      fired = true;
      this.lastFire = now;
    }
    this.wasActive = active;
    return fired;
  }
  reset() {
    this.wasActive = false;
  }
}
