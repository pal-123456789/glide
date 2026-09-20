// Integration test: does Demo Mode actually produce clicks?
// This mirrors what app.js does in loopDemo -> driveCursorTo -> dwell.update,
// minus the DOM. If the DemoDriver rests on a target long enough, the
// DwellClicker MUST fire; while travelling between targets it must NOT.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoDriver } from '../src/demopath.js';
import { DwellClicker } from '../src/gestures.js';

test('Demo Mode fires a click on each rested target, none while travelling', () => {
  const W = 1280, H = 800;
  const targets = [
    { x: 0.30, y: 0.29, hold: 1300 },
    { x: 0.20, y: 0.52, hold: 1300 },
    { x: 0.46, y: 0.52, hold: 1300 },
    { x: 0.36, y: 0.86, hold: 1500 },
  ];
  const driver = new DemoDriver(targets, { travelMs: 1200 });
  const dwell = new DwellClicker({ dwellMs: 900, moveTolerance: 46, refractoryMs: 450 });

  let clicks = 0;
  let clicksWhileMoving = 0;
  const dt = 16; // ~60fps
  const loops = 1; // one full pass through the targets
  const total = driver.loopDuration() * loops;

  for (let now = 0; now <= total; now += dt) {
    const s = driver.sample(now);
    const x = s.x * W, y = s.y * H;
    const r = dwell.update(x, y, now);
    if (r.click) {
      clicks++;
      if (!s.resting) clicksWhileMoving++;
    }
  }

  // One click per target while resting (hold >> dwell, but refractory caps repeats).
  assert.ok(clicks >= targets.length, `expected >=${targets.length} clicks, got ${clicks}`);
  assert.equal(clicksWhileMoving, 0, 'must never click mid-travel');
});

test('Demo Mode is deterministic across loops (same clicks second time round)', () => {
  const targets = [
    { x: 0.3, y: 0.3, hold: 1200 },
    { x: 0.7, y: 0.7, hold: 1200 },
  ];
  const run = () => {
    const d = new DemoDriver(targets, { travelMs: 1000 });
    const dw = new DwellClicker({ dwellMs: 800, refractoryMs: 400 });
    let c = 0;
    for (let now = 0; now <= d.loopDuration(); now += 16) {
      const s = d.sample(now);
      if (dw.update(s.x * 1000, s.y * 700, now).click) c++;
    }
    return c;
  };
  assert.equal(run(), run(), 'demo click count is stable run-to-run');
});
