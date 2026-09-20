// Tests for the production modules: store, calibration, scanning, adaptive predict.
import test from 'node:test';
import assert from 'node:assert/strict';

import { Store, MemoryStorage, scoreLearned, DEFAULT_SETTINGS } from '../src/store.js';
import { fitAffine, applyAffine, solve3x3, targets9, targets5, rmsError } from '../src/calibrate.js';
import { ScanController } from '../src/scanning.js';
import { predictAdaptive } from '../src/predict.js';

// ---------------- store.js ----------------
test('Store returns defaults then persists a patch', () => {
  const s = new Store(new MemoryStorage());
  assert.equal(s.getSettings().dwellMs, DEFAULT_SETTINGS.dwellMs);
  s.saveSettings({ dwellMs: 1300, voiceOn: false });
  assert.equal(s.getSettings().dwellMs, 1300);
  assert.equal(s.getSettings().voiceOn, false);
  assert.equal(s.getSettings().sensitivity, DEFAULT_SETTINGS.sensitivity); // untouched
});

test('Store survives corrupt JSON without throwing', () => {
  const mem = new MemoryStorage();
  mem.setItem('glide:v2:settings', '{not valid json');
  const s = new Store(mem);
  assert.deepEqual(s.getSettings(), { ...DEFAULT_SETTINGS });
});

test('Store falls back to memory when backend throws', () => {
  const hostile = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {} };
  const s = new Store(hostile);        // constructor probe fails -> memory
  assert.doesNotThrow(() => s.saveSettings({ rate: 1.2 }));
});

test('learnWord accumulates frequency and recency, ranks by score', () => {
  const s = new Store(new MemoryStorage());
  const now = 1_000_000_000_000;
  s.learnWord('water', now);
  s.learnWord('water', now);
  s.learnWord('warm', now - 30 * 86400000); // old
  const ranked = s.learnedStartingWith('wa', now);
  assert.equal(ranked[0], 'water', 'frequent+recent word ranks first');
});

test('scoreLearned decays with age', () => {
  const now = 1_000_000_000_000;
  const fresh = scoreLearned({ n: 1, t: now }, now);
  const old = scoreLearned({ n: 1, t: now - 14 * 86400000 }, now);
  assert.ok(fresh > old, 'recent word scores higher than a stale one');
});

test('history de-dupes and caps at 20', () => {
  const s = new Store(new MemoryStorage());
  for (let i = 0; i < 25; i++) s.pushHistory('sentence ' + (i % 5), 1000 + i);
  const h = s.getHistory();
  assert.ok(h.length <= 20);
  const texts = h.map((x) => x.text);
  assert.equal(new Set(texts).size, texts.length, 'no duplicate sentences');
});

// ---------------- calibrate.js ----------------
test('solve3x3 solves a known system', () => {
  // x=1,y=2,z=3 for identity-ish system
  const M = [[2, 0, 0], [0, 3, 0], [0, 0, 4]];
  const v = [2, 6, 12];
  assert.deepEqual(solve3x3(M, v), [1, 2, 3]);
});

test('solve3x3 returns null for singular matrix', () => {
  const M = [[1, 2, 3], [2, 4, 6], [1, 1, 1]]; // row2 = 2*row1
  assert.equal(solve3x3(M, [1, 2, 3]), null);
});

test('fitAffine recovers a known affine transform', () => {
  // Ground-truth map: sx = 1000*nx + 0*ny + 50 ; sy = 0*nx + 800*ny + 20
  const truth = { ax: 1000, bx: 0, cx: 50, ay: 0, by: 800, cy: 20 };
  const samples = targets9().map(({ fx, fy }) => {
    // pretend head coords equal target fractions plus a tiny wobble
    const nx = fx, ny = fy;
    return { nx, ny, sx: truth.ax * nx + truth.cx, sy: truth.by * ny + truth.cy };
  });
  const model = fitAffine(samples);
  assert.ok(model, 'fit should succeed');
  const p = applyAffine(model, 0.5, 0.5, 1000, 800);
  assert.ok(Math.abs(p.x - (1000 * 0.5 + 50)) < 1, `x≈550, got ${p.x}`);
  assert.ok(Math.abs(p.y - (800 * 0.5 + 20)) < 1, `y≈420, got ${p.y}`);
  assert.ok(rmsError(model, samples, 1000, 800) < 1, 'residual should be ~0 on clean data');
});

test('fitAffine tolerates noise (residual bounded, still usable)', () => {
  const truth = { ax: 900, bx: 40, cx: 30, ay: 30, by: 850, cy: 10 };
  let seed = 42;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed / 0x7fffffff - 0.5); };
  const samples = targets9().map(({ fx, fy }) => ({
    nx: fx, ny: fy,
    sx: truth.ax * fx + truth.bx * fy + truth.cx + rnd() * 8,
    sy: truth.ay * fx + truth.by * fy + truth.cy + rnd() * 8,
  }));
  const model = fitAffine(samples);
  assert.ok(model, 'fit succeeds under noise');
  assert.ok(rmsError(model, samples, 1000, 800) < 20, 'residual stays small under mild noise');
});

test('fitAffine returns null with too few points', () => {
  assert.equal(fitAffine([{ nx: 0.5, ny: 0.5, sx: 1, sy: 1 }]), null);
});

test('target grids have expected counts', () => {
  assert.equal(targets9().length, 9);
  assert.equal(targets5().length, 5);
});

// ---------------- scanning.js ----------------
test('ScanController steps through rows on a timer and wraps', () => {
  const sc = new ScanController([3, 3, 3], { speedMs: 100 });
  sc.enable(0);
  assert.equal(sc.getHighlight().row, 0);
  sc.tick(100); assert.equal(sc.getHighlight().row, 1);
  sc.tick(200); assert.equal(sc.getHighlight().row, 2);
  sc.tick(300); assert.equal(sc.getHighlight().row, 0, 'wraps back to 0');
});

test('ScanController does not advance before speedMs elapses', () => {
  const sc = new ScanController([3, 3], { speedMs: 100 });
  sc.enable(0);
  sc.tick(50);
  assert.equal(sc.getHighlight().row, 0, 'too soon to step');
});

test('ScanController select: row -> col -> commit cell', () => {
  const sc = new ScanController([4, 2], { speedMs: 100 });
  sc.enable(0);
  sc.tick(100); // row 1
  assert.equal(sc.getHighlight().row, 1);
  assert.equal(sc.select(100), null, 'first select descends into columns');
  assert.equal(sc.getHighlight().level, 'col');
  sc.tick(200); // col 1 within row 1 (row 1 has 2 cells)
  const pick = sc.select(200);
  assert.deepEqual(pick, { row: 1, col: 1 }, 'second select commits the cell');
  assert.equal(sc.getHighlight().level, 'row', 'returns to row scanning');
});

test('ScanController column wrap respects that row size', () => {
  const sc = new ScanController([2], { speedMs: 100 });
  sc.enable(0);
  sc.select(0);              // into columns of row 0 (2 cells)
  sc.tick(100);              // col 1
  assert.equal(sc.getHighlight().col, 1);
  sc.tick(200);              // wrap to col 0
  assert.equal(sc.getHighlight().col, 0);
});

// ---------------- adaptive predict ----------------
test('predictAdaptive without store equals base predict', () => {
  const a = predictAdaptive('hel', 4, null);
  assert.ok(a.includes('help'));
});

test('predictAdaptive surfaces a learned word ahead of the general model', () => {
  const s = new Store(new MemoryStorage());
  const now = 2_000_000_000_000;
  for (let i = 0; i < 5; i++) s.learnWord('helipad', now); // a personal word
  const out = predictAdaptive('hel', 4, s, now);
  assert.equal(out[0], 'helipad', `personal word should lead, got ${JSON.stringify(out)}`);
  assert.ok(out.includes('help'), 'general suggestions still present');
});

test('predictAdaptive keeps starters clean on empty buffer', () => {
  const s = new Store(new MemoryStorage());
  s.learnWord('water', Date.now());
  const out = predictAdaptive('', 4, s);
  assert.ok(out.includes('I'), 'capitalized starters preserved at sentence start');
});
