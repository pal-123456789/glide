// scanning.js — row/column "switch scanning" input.
// Pure logic, no DOM. Testable in node.
//
// Some people have exactly ONE reliable movement (a single blink, a head tilt,
// one button). Switch scanning is the established AAC technique for them:
//   1. A highlight steps through the ROWS automatically, one every `speedMs`.
//   2. The user triggers a select on the row they want.
//   3. The highlight then steps through the CELLS of that row.
//   4. A second select activates the cell.
// This lets a whole keyboard be operated with a single, timing-based signal.
//
// The controller owns timing and position; the UI just renders getHighlight()
// and calls select() when the user's switch fires (dwell OR blink).

export class ScanController {
  /**
   * @param {number[]} rowSizes  number of selectable cells in each row
   * @param {object} opts
   * @param {number} opts.speedMs step interval
   */
  constructor(rowSizes, { speedMs = 1200 } = {}) {
    this.setLayout(rowSizes);
    this.speedMs = speedMs;
    this.enabled = false;
  }

  setLayout(rowSizes) {
    this.rowSizes = (rowSizes && rowSizes.length ? rowSizes : [1]).slice();
    this.level = 'row';   // 'row' | 'col'
    this.row = 0;
    this.col = 0;
    this.lastStep = null;
  }

  enable(now = 0) { this.enabled = true; this.level = 'row'; this.row = 0; this.col = 0; this.lastStep = now; }
  disable() { this.enabled = false; }
  setSpeed(ms) { this.speedMs = Math.max(300, ms); }

  /** Advance the highlight if enough time has passed. Call every frame. */
  tick(now) {
    if (!this.enabled) return;
    if (this.lastStep == null) { this.lastStep = now; return; }
    if (now - this.lastStep < this.speedMs) return;
    this.lastStep = now;
    if (this.level === 'row') {
      this.row = (this.row + 1) % this.rowSizes.length;
    } else {
      const cells = this.rowSizes[this.row] || 1;
      this.col = (this.col + 1) % cells;
    }
  }

  /**
   * Fire the user's switch. Returns a selection when a cell is chosen.
   * @returns {null | {row:number, col:number}}
   */
  select(now = 0) {
    if (!this.enabled) return null;
    if (this.level === 'row') {
      // Descend into the chosen row's cells.
      this.level = 'col';
      this.col = 0;
      this.lastStep = now;
      return null;
    }
    // Commit the cell, then restart from row scanning.
    const pick = { row: this.row, col: this.col };
    this.level = 'row';
    this.row = 0;
    this.col = 0;
    this.lastStep = now;
    return pick;
  }

  /** Where the highlight currently is, for the UI to render. */
  getHighlight() {
    if (!this.enabled) return { active: false };
    return this.level === 'row'
      ? { active: true, level: 'row', row: this.row }
      : { active: true, level: 'col', row: this.row, col: this.col };
  }
}
