// Unit tests for Glide's browser-free core logic.
// Run: node --test
import test from 'node:test';
import assert from 'node:assert/strict';

import { OneEuro, OneEuro2D, LowPass, clamp } from '../src/filter.js';
import { CursorMapper } from '../src/cursor.js';
import { DwellClicker, BlinkClicker, ExpressionTrigger } from '../src/gestures.js';
import { predict, applySuggestion } from '../src/predict.js';
import { DemoDriver } from '../src/demopath.js';

// ---------- filter.js ----------
test('clamp bounds values', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(99, 0, 10), 10);
});

test('LowPass first sample passes through, then blends', () => {
  const lp = new LowPass();
  assert.equal(lp.filter(10, 0.5), 10);      // first sample = raw
  assert.equal(lp.filter(20, 0.5), 15);      // 0.5*20 + 0.5*10
});

test('OneEuro smooths a constant signal to itself', () => {
  const f = new OneEuro();
  let t = 0, out = 0;
  for (let i = 0; i < 30; i++) { out = f.filter(5.0, (t += 16)); }
  assert.ok(Math.abs(out - 5.0) < 1e-6, `expected ~5, got ${out}`);
});

test('OneEuro reduces jitter variance vs raw', () => {
  const f = new OneEuro({ minCutoff: 1.0, beta: 0.001 });
  let t = 0;
  const raws = [], filts = [];
  for (let i = 0; i < 200; i++) {
    const raw = 0.5 + (Math.random() - 0.5) * 0.2; // noisy around 0.5
    raws.push(raw);
    filts.push(f.filter(raw, (t += 16)));
  }
  const varOf = (a) => {
    const m = a.reduce((s, v) => s + v, 0) / a.length;
    return a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length;
  };
  assert.ok(varOf(filts) < varOf(raws) * 0.5, 'filtered variance should be <50% of raw');
});

test('OneEuro handles zero/duplicate timestamps without NaN', () => {
  const f = new OneEuro();
  f.filter(1, 100);
  const out = f.filter(2, 100); // dt = 0
  assert.ok(Number.isFinite(out), 'must not be NaN/Inf on dt=0');
});

test('OneEuro2D filters both channels', () => {
  const f = new OneEuro2D();
  const p = f.filter(0.3, 0.7, 16);
  assert.equal(p.x, 0.3);
  assert.equal(p.y, 0.7);
});

// ---------- cursor.js ----------
test('CursorMapper center maps to screen center', () => {
  const m = new CursorMapper();
  const { x, y } = m.toScreen(0.5, 0.5, 1000, 800);
  assert.ok(Math.abs(x - 500) < 1, `x=${x}`);
  assert.ok(Math.abs(y - 400) < 1, `y=${y}`);
});

test('CursorMapper dead-zone ignores tiny movements', () => {
  const m = new CursorMapper({ deadZone: 0.06 });
  const { x, y } = m.toScreen(0.52, 0.52, 1000, 800); // within dead-zone
  assert.ok(Math.abs(x - 500) < 1, 'tiny x move suppressed');
  assert.ok(Math.abs(y - 400) < 1, 'tiny y move suppressed');
});

test('CursorMapper mirrors X (turn right -> go right)', () => {
  const m = new CursorMapper({ mirrorX: true });
  // In a mirrored front camera, turning right lowers your normalized x.
  const { x } = m.toScreen(0.35, 0.5, 1000, 800);
  assert.ok(x > 500, `mirrored: nx<center should push right, got x=${x}`);
});

test('CursorMapper reaches screen edges within head range', () => {
  const m = new CursorMapper({ sensitivity: 1.4 });
  const left = m.toScreen(0.72, 0.5, 1000, 800); // big turn (mirrored -> left)
  assert.ok(left.x < 60, `should reach near left edge, got ${left.x}`);
});

test('CursorMapper output always within viewport', () => {
  const m = new CursorMapper({ sensitivity: 3.0 });
  for (const nx of [0, 0.1, 0.5, 0.9, 1]) {
    for (const ny of [0, 0.5, 1]) {
      const { x, y } = m.toScreen(nx, ny, 1200, 900);
      assert.ok(x >= 0 && x <= 1200, `x in range: ${x}`);
      assert.ok(y >= 0 && y <= 900, `y in range: ${y}`);
    }
  }
});

// ---------- gestures.js ----------
test('DwellClicker fires after dwell time when still', () => {
  const d = new DwellClicker({ dwellMs: 500, moveTolerance: 40 });
  let now = 0, clicks = 0;
  for (let i = 0; i < 40; i++) {
    const r = d.update(100, 100, (now += 20)); // hold still
    if (r.click) clicks++;
  }
  assert.ok(clicks >= 1, 'should click at least once while dwelling');
});

test('DwellClicker does NOT fire while moving', () => {
  const d = new DwellClicker({ dwellMs: 500, moveTolerance: 40 });
  let now = 0, clicks = 0, x = 0;
  for (let i = 0; i < 40; i++) {
    const r = d.update((x += 60), 100, (now += 20)); // moving fast
    if (r.click) clicks++;
  }
  assert.equal(clicks, 0, 'no click while pointer travels');
});

test('DwellClicker respects refractory (no machine-gun clicks)', () => {
  const d = new DwellClicker({ dwellMs: 200, refractoryMs: 500 });
  let now = 0, clicks = 0;
  for (let i = 0; i < 100; i++) { // ~2s of holding still
    const r = d.update(100, 100, (now += 20));
    if (r.click) clicks++;
  }
  // Without refractory this would be ~10; with 500ms it should be ~ a handful.
  assert.ok(clicks <= 5 && clicks >= 1, `clicks bounded by refractory, got ${clicks}`);
});

test('DwellClicker progress climbs from 0 toward 1', () => {
  const d = new DwellClicker({ dwellMs: 500 });
  d.update(100, 100, 0);
  const mid = d.update(100, 100, 250);
  assert.ok(mid.progress > 0.4 && mid.progress < 0.6, `progress ~0.5, got ${mid.progress}`);
});

test('BlinkClicker fires on deliberate blink, ignores quick natural blink', () => {
  const b = new BlinkClicker({ minCloseMs: 220, refractoryMs: 100 });
  // quick 100ms blink -> ignored
  b.update(0.9, 0.9, 0);
  let r = b.update(0.0, 0.0, 100);
  assert.equal(r.click, false, 'quick blink ignored');
  // deliberate 300ms blink -> click
  b.update(0.9, 0.9, 1000);
  r = b.update(0.0, 0.0, 1300);
  assert.equal(r.click, true, 'deliberate blink clicks');
});

test('BlinkClicker ignores a wink (one eye only)', () => {
  const b = new BlinkClicker({ minCloseMs: 200 });
  b.update(0.9, 0.1, 0);       // only left closed
  const r = b.update(0.0, 0.0, 400);
  assert.equal(r.click, false, 'wink must not click');
});

test('ExpressionTrigger fires once on rising edge', () => {
  const e = new ExpressionTrigger({ thresh: 0.5, refractoryMs: 300 });
  let fires = 0, now = 0;
  const seq = [0.1, 0.2, 0.8, 0.9, 0.85, 0.2, 0.1, 0.7]; // two separate rises
  for (const s of seq) { if (e.update(s, (now += 200))) fires++; }
  assert.equal(fires, 2, `two rising edges -> 2 fires, got ${fires}`);
});

// ---------- predict.js ----------
test('predict returns starters on empty buffer', () => {
  const s = predict('', 4);
  assert.equal(s.length, 4);
  assert.ok(s.includes('I'));
});

test('predict completes a partial word by frequency', () => {
  const s = predict('hel', 4);
  assert.ok(s.includes('help'), `expected help in ${JSON.stringify(s)}`);
});

test('predict uses bigram context for next word', () => {
  const s = predict('i need ', 4);
  assert.equal(s[0], 'help', `"i need" -> help first, got ${JSON.stringify(s)}`);
});

test('predict backs off to frequency for unknown context', () => {
  const s = predict('xyzzy ', 4);
  assert.ok(s.length === 4, 'still returns suggestions via back-off');
});

test('applySuggestion completes a partial word', () => {
  assert.equal(applySuggestion('i ne', 'need'), 'i need ');
});

test('applySuggestion appends after a completed word', () => {
  assert.equal(applySuggestion('i need ', 'help'), 'i need help ');
});

// ---------- demopath.js ----------
test('DemoDriver stays within [0,1] and visits targets', () => {
  const targets = [
    { x: 0.5, y: 0.5, hold: 300 },
    { x: 0.2, y: 0.3, hold: 300 },
    { x: 0.8, y: 0.7, hold: 300 },
  ];
  const d = new DemoDriver(targets, { travelMs: 500 });
  let sawResting = false;
  for (let t = 0; t <= d.loopDuration() * 2; t += 50) {
    const s = d.sample(t);
    assert.ok(s.x >= 0 && s.x <= 1, `x in range: ${s.x}`);
    assert.ok(s.y >= 0 && s.y <= 1, `y in range: ${s.y}`);
    if (s.resting) sawResting = true;
  }
  assert.ok(sawResting, 'driver should rest on targets (to allow dwell clicks)');
});

test('DemoDriver loops (same position one loop apart)', () => {
  const targets = [
    { x: 0.4, y: 0.4, hold: 200 },
    { x: 0.6, y: 0.6, hold: 200 },
  ];
  const d = new DemoDriver(targets, { travelMs: 400 });
  const a = d.sample(1000);
  const b = d.sample(1000 + d.loopDuration());
  assert.ok(Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6, 'loops cleanly');
});

test('DemoDriver rejects too-few targets', () => {
  assert.throws(() => new DemoDriver([{ x: 0.5, y: 0.5 }]), /at least 2/);
});
