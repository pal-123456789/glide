// app.js — Glide controller (production).
// Wires the signal source (FaceTracker OR DemoDriver) through the tested core
// (OneEuro -> Cursor/Calibration -> Dwell/Blink/Gestures/Scanning) and drives
// the DOM: cursor + dwell ring, real clicks by dwelling, categorized speech
// boards, personalized prediction, TTS, 9-point calibration, switch-scanning,
// HUD and a first-run tutorial. Settings & learned words persist locally.

import { OneEuro2D, clamp } from './filter.js';
import { CursorMapper } from './cursor.js';
import { DwellClicker, BlinkClicker, ExpressionTrigger } from './gestures.js';
import { predictAdaptive, applySuggestion } from './predict.js';
import { DemoDriver } from './demopath.js';
import { FaceTracker } from './tracker.js';
import { Store } from './store.js';
import { fitAffine, applyAffine, targets9, rmsError } from './calibrate.js';
import { ScanController } from './scanning.js';

const $ = (id) => document.getElementById(id);
const store = new Store();

const state = {
  mode: null,            // 'camera' | 'demo'
  running: false,
  view: 'board',         // 'board' | 'settings'
  board: 'keyboard',     // 'keyboard' | category id
  sentence: '',
  calibrating: false,
  affine: null,          // fitted calibration model (camera space -> screen)
  lastOkTime: 0,
  settings: store.getSettings(),
};

// --- tuned instances of the tested core (seeded from saved settings) ---
const smoother = new OneEuro2D({ minCutoff: 1.0, beta: 0.012 });
const mapper = new CursorMapper({ sensitivity: state.settings.sensitivity, deadZone: 0.06, mirrorX: true });
let dwell = makeDwell(state.settings.dwellMs);
const blink = new BlinkClicker({ minCloseMs: 240, refractoryMs: 800 });
const gJaw = new ExpressionTrigger({ thresh: 0.55, refractoryMs: 1200 });   // open mouth -> speak
const gBrow = new ExpressionTrigger({ thresh: 0.5, refractoryMs: 1200 });   // brows up -> delete word
// a deliberately LONG blink (0.5s) skips calibration hands-free, so a user whose
// tracking is too rough to hold a point is never trapped on the calibration step.
const calibBlink = new BlinkClicker({ minCloseMs: 500, refractoryMs: 1200 });
const scanner = new ScanController([1], { speedMs: state.settings.scanSpeedMs });

const tracker = new FaceTracker();
let demo = null;
const RING_CIRC = 2 * Math.PI * 23;

let cursorX = window.innerWidth / 2;
let cursorY = window.innerHeight / 2;
let hotEl = null;
let voices = [];
let voiceIndex = -1;

function makeDwell(ms) { return new DwellClicker({ dwellMs: ms, moveTolerance: 46, refractoryMs: 450 }); }

// ============================ signal handling ============================
function handleSignal(sig) {
  if (!sig || sig.ok === false) {
    setStatus(state.mode === 'demo' ? 'demo' : 'searching');
    return;
  }
  state.lastOkTime = performance.now();
  const t = sig.t ?? performance.now();
  const { x: fx, y: fy } = smoother.filter(sig.nx, sig.ny, t);

  if (state.calibrating) {
    feedCalibration(fx, fy, t);
    // hands-free escape hatch: a long blink skips calibration (see calibBlink).
    if (state.mode === 'camera' && sig.blinkL != null &&
        calibBlink.update(sig.blinkL, sig.blinkR, t).click) cancelCalibration();
    return;
  }

  // camera space -> screen: prefer the fitted affine model, else the mapper
  let p;
  if (state.affine) p = applyAffine(state.affine, fx, fy, window.innerWidth, window.innerHeight);
  else p = mapper.toScreen(fx, fy, window.innerWidth, window.innerHeight);
  updateTrackDot(fx, fy);

  // What is the pointer allowed to ACTIVATE this frame? While paused, only the
  // Resume control; while an overlay is open, only that overlay's own buttons.
  // (The cursor is still shown for feedback either way — the fix for "Pause did
  // nothing / kept clicking", and for clicks bleeding through overlays.)
  const scope = activationScope();
  const gated = scope !== null;   // paused or an overlay is up

  if (state.settings.scanMode) {
    // In scan mode the pointer isn't used to aim; a blink or a dwell on the
    // SELECT bar is the single "switch". We still show the cursor for feedback.
    renderCursor(p.x, p.y);
    cursorX = p.x; cursorY = p.y;
    const el = elementAtCursor(p.x, p.y, scope);
    setHot(el);
    if (!el) { setRing(0); dwell.reset(); }
    else {
      const c = anchorFor(el);
      const d = dwell.update(c.x, c.y, t);
      setRing(d.progress);
      // Resume (btnStop) is dwell-selectable even in scan mode so a paused,
      // hands-free user always has a way back.
      if (d.click && (el.id === 'scanSelect' || el.id === 'btnStop')) activate(el);
    }
  } else {
    driveCursorTo(p.x, p.y, t);
  }

  // blink-to-click / scan-select + head gestures (camera only). Suppressed while
  // paused or an overlay is open so a blink can't fire a click behind the scenes.
  if (state.mode === 'camera' && sig.blinkL != null && !gated) {
    if (state.settings.blinkOn) {
      const b = blink.update(sig.blinkL, sig.blinkR, t);
      if (b.click) {
        if (state.settings.scanMode) scanSelect();
        else if (hotEl) { setRing(1); activate(hotEl); dwell.reset(); }
      }
    }
    // head gestures
    if (state.settings.gesturesOn) {
      if (gJaw.update(sig.jawOpen ?? 0, t)) speak(state.sentence);
      if (gBrow.update(sig.browUp ?? 0, t)) backspaceWord();
    }
  }
  setStatus(!state.running ? 'paused' : state.mode === 'demo' ? 'demo' : 'live');
}

// The set of elements the pointer may activate right now (null = everything).
function openOverlay() {
  const ids = ['startOverlay', 'loadOverlay', 'errOverlay', 'tutOverlay'];
  for (const id of ids) { const el = $(id); if (el && !el.classList.contains('hidden')) return el; }
  return null;
}
function activationScope() {
  const ov = openOverlay();
  if (ov) return ov;                 // only the open overlay's buttons are live
  if (!state.running) return $('btnStop'); // paused: only Resume is live
  return null;                       // normal operation: everything is live
}

// Shared pointer pipeline for camera + demo. Demo passes screen pixels directly.
function driveCursorTo(x, y, t) {
  cursorX = x; cursorY = y;
  renderCursor(x, y);
  const scope = activationScope();
  // Hands-free scrolling: resting in a scroll-edge zone scrolls the view instead
  // of clicking. Checked BEFORE the dwell-click so a control sitting in the edge
  // band can't fire while the user is really trying to reach content past it.
  const scrolling = updateEdgeScroll(x, y, t, scope);
  const el = elementAtCursor(x, y, scope);
  setHot(el);
  // Only dwell when actually resting on a target. Over empty space the ring must
  // stay empty (it used to fill anywhere, complete, then click nothing — the "ring
  // fills but doesn't write" bug). When we ARE on a target, feed the dwell the
  // target's fixed center, not the jittery pointer, so small head shake can't
  // reset the fill — the pointer just has to stay near the key, not dead-still.
  if (scrolling || !el) { setRing(0); dwell.reset(); return; }
  const c = anchorFor(el);
  const d = dwell.update(c.x, c.y, t);
  setRing(d.progress);
  if (d.click) activate(el);
}
// Center of a target's box — the stable point we run the dwell timer against.
function anchorFor(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// ============================ hands-free edge-scroll ============================
// When a scrollable view (Settings, or the board on a short viewport) is longer
// than the stage, a purely hands-free user can't reach the overflow — there's no
// wheel or drag. So when the cursor rests near the top/bottom edge of the active
// scroll container we auto-scroll it, after a short arm delay (so merely passing
// through the band doesn't scroll), with a visible affordance.
let edgeDir = 0, edgeSince = 0;
const EDGE_MARGIN = 74;   // px band at each edge that triggers scrolling
const EDGE_ARM_MS = 240;  // rest this long in the band before it starts
const EDGE_SPEED = 13;    // px per frame once armed
function activeScrollContainer() {
  const el = state.view === 'settings' ? $('settingsView') : $('boardView');
  if (!el || el.style.display === 'none') return null;
  return (el.scrollHeight - el.clientHeight > 4) ? el : null;
}
function updateEdgeScroll(x, y, t, scope) {
  // never hijack scrolling while paused or an overlay is up (scope != null)
  const c = scope ? null : activeScrollContainer();
  if (!c) { edgeDir = 0; showEdgeHint(0); return false; }
  const r = c.getBoundingClientRect();
  const canUp = c.scrollTop > 1;
  const canDown = c.scrollTop < c.scrollHeight - c.clientHeight - 1;
  let dir = 0;
  if (y < r.top + EDGE_MARGIN && canUp) dir = -1;
  else if (y > r.bottom - EDGE_MARGIN && canDown) dir = 1;
  if (dir === 0) { edgeDir = 0; showEdgeHint(0); return false; }
  if (edgeDir !== dir) { edgeDir = dir; edgeSince = t; }   // (re)arm on entry
  const armed = t - edgeSince >= EDGE_ARM_MS;
  showEdgeHint(dir, armed);
  if (!armed) return false;
  c.scrollTop += dir * EDGE_SPEED;
  return true;
}
function showEdgeHint(dir, armed) {
  const up = $('edgeUp'), down = $('edgeDown');
  if (!up || !down) return;
  up.classList.toggle('show', dir === -1);
  up.classList.toggle('active', dir === -1 && !!armed);
  down.classList.toggle('show', dir === 1);
  down.classList.toggle('active', dir === 1 && !!armed);
}

// ============================ cursor rendering ============================
const cursorEl = $('cursor');
const ringFg = $('ringFg');
ringFg.style.strokeDasharray = String(RING_CIRC);
ringFg.style.strokeDashoffset = String(RING_CIRC);

function renderCursor(x, y) {
  cursorEl.classList.remove('hidden');
  cursorEl.style.transform = `translate(${x}px, ${y}px)`;
  spawnTrail(x, y);
}
let trailNodes = [];
function spawnTrail(x, y) {
  if (prefersReducedMotion()) return;
  const dot = document.createElement('div');
  dot.className = 'trail-dot';
  dot.style.left = x + 'px'; dot.style.top = y + 'px';
  document.body.appendChild(dot);
  const born = performance.now();
  const step = () => {
    const age = performance.now() - born;
    const k = 1 - age / 380;
    if (k <= 0) { dot.remove(); return; }
    dot.style.opacity = String(k * 0.6);
    dot.style.transform = `scale(${k})`;
    requestAnimationFrame(step);
  };
  step();
}
function setRing(progress) {
  ringFg.style.strokeDashoffset = String(RING_CIRC * (1 - clamp(progress, 0, 1)));
}

// ============================ hit-testing & activation ============================
const SNAP_PX = 46;   // magnetic slack around a target, for imprecise head tracking
function elementAtCursor(x, y, scope) {
  const stack = document.elementsFromPoint(x, y) || [];
  for (const node of stack) {
    if (node.closest) {
      const t = node.closest('.target, .key, .phrase, .cat, .hist-item, input[type=range]');
      // when a scope is set (paused / overlay open) only targets inside it count
      if (t && (!scope || scope.contains(t))) return t;
    }
  }
  // Magnetic targeting: head tracking is imprecise, so if the exact point lands
  // in a gap, snap to the nearest target whose box is within SNAP_PX. This is what
  // makes low-accuracy tracking usable — you get *near* a key and it locks on,
  // instead of the pointer sitting forever in the seams between keys.
  return nearestTarget(x, y, scope);
}
function nearestTarget(x, y, scope) {
  const root = scope || document;
  const nodes = root.querySelectorAll('.target, .key, .phrase, .cat, .hist-item');
  let best = null, bestD = SNAP_PX;
  for (const el of nodes) {
    if (el.offsetParent === null) continue;      // skip hidden / detached
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    const d = Math.hypot(dx, dy);                // 0 when the point is inside the box
    if (d < bestD) { bestD = d; best = el; }
  }
  return best;
}
function setHot(el) {
  if (hotEl === el) return;
  if (hotEl) hotEl.classList.remove('hot');
  hotEl = el;
  if (hotEl) hotEl.classList.add('hot');
  dwell.reset();
  setRing(0);
}
function activate(el) {
  if (!el) return;
  flash(el);
  if (el.dataset.key !== undefined) return typeKey(el.dataset.key);
  if (el.dataset.phrase !== undefined) return speakPhrase(el.dataset.phrase);
  if (el.dataset.sugg !== undefined) return chooseSuggestion(el.dataset.sugg);
  if (el.dataset.cat !== undefined) return switchBoard(el.dataset.cat);
  if (el.dataset.hist !== undefined) return speakPhrase(el.dataset.hist);
  if (el.id) return handleControl(el);
  if (el.tagName === 'INPUT' && el.type === 'range') return nudgeRange(el);
}
function flash(el) {
  const prev = el.style.background;
  el.style.background = 'var(--amber)'; el.style.color = '#1a1200';
  setTimeout(() => { el.style.background = prev; el.style.color = ''; }, 130);
}

// ============================ boards ============================
const KEYS = [
  ['q','w','e','r','t','y','u','i','o','p'],
  ['a','s','d','f','g','h','j','k','l'],
  ['space','z','x','c','v','b','n','m','back'],
];
const CATEGORIES = [
  { id: 'keyboard', label: 'Keyboard' },
  { id: 'needs', label: 'Needs' },
  { id: 'feelings', label: 'Feelings' },
  { id: 'people', label: 'People' },
  { id: 'places', label: 'Places' },
  { id: 'answers', label: 'Answers' },
];
const BOARDS = {
  needs: ['I need help', 'Water', 'Food', 'Bathroom', 'Medicine', 'Blanket', 'Sit me up', 'Lie down'],
  feelings: ['Happy', 'Tired', "I'm in pain", 'Cold', 'Hot', 'Scared', "I'm okay", 'Feeling better'],
  people: ['Family', 'Doctor', 'Nurse', 'Friend', 'You', 'Me'],
  places: ['Home', 'Bed', 'Bathroom', 'Outside', 'Hospital', 'Here'],
  answers: ['Yes', 'No', 'Maybe', 'Thank you', 'Please', 'Sorry'],
};
const URGENT = new Set(['I need help', "I'm in pain"]);

function buildCats() {
  const box = $('cats'); box.innerHTML = '';
  CATEGORIES.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'target cat' + (c.id === state.board ? ' active' : '');
    b.dataset.cat = c.id; b.textContent = c.label;
    box.appendChild(b);
  });
}
function buildKeyboard() {
  const kb = $('keyboard'); kb.innerHTML = '';
  KEYS.forEach((row, i) => {
    const r = document.createElement('div');
    r.className = 'row ' + (i === 1 ? 'mid' : i === 2 ? 'low' : 'top');
    row.forEach((k) => {
      const b = document.createElement('button');
      b.className = 'target key' + (k.length > 1 ? ' wide' : '');
      b.dataset.key = k;
      b.textContent = k === 'space' ? '␣ space' : k === 'back' ? '⌫ delete' : k;
      b.setAttribute('aria-label', k === 'space' ? 'space' : k === 'back' ? 'delete' : k);
      r.appendChild(b);
    });
    kb.appendChild(r);
  });
}
function buildPhraseGrid(catId) {
  const grid = $('phraseGrid'); grid.innerHTML = '';
  (BOARDS[catId] || []).forEach((text) => {
    const b = document.createElement('button');
    b.className = 'target phrase' + (URGENT.has(text) ? ' urgent' : '');
    b.dataset.phrase = text; b.textContent = text;
    grid.appendChild(b);
  });
}
function switchBoard(catId) {
  state.board = catId;
  buildCats();
  const isKb = catId === 'keyboard';
  $('keyboard').style.display = isKb ? '' : 'none';
  $('phraseGrid').style.display = isKb ? 'none' : '';
  $('suggests').style.display = isKb ? '' : 'none';
  if (!isKb) buildPhraseGrid(catId);
  refreshScanLayout();
}

// ============================ typing & suggestions ============================
function typeKey(k) {
  if (k === 'space') state.sentence += ' ';
  else if (k === 'back') state.sentence = state.sentence.replace(/.$/, '');
  else state.sentence += k;
  renderSentence(); renderSuggests();
}
function backspaceWord() {
  state.sentence = state.sentence.replace(/\s*\S+\s*$/, '');
  renderSentence(); renderSuggests();
}
function chooseSuggestion(word) {
  state.sentence = applySuggestion(state.sentence, word);
  renderSentence(); renderSuggests();
}
function renderSentence() {
  const box = $('sayText');
  const caret = '<span class="caret" aria-hidden="true"></span>';
  box.innerHTML = state.sentence
    ? escapeHtml(state.sentence) + caret
    : '<span class="placeholder hint">Your words appear here…</span>' + caret;
  // keep the tail + caret visible: the bar is a single non-wrapping line, so as
  // the sentence grows past the width we scroll to the end (otherwise the newest
  // characters — the ones the user is typing — would sit off-screen to the right).
  box.scrollLeft = box.scrollWidth;
}
function renderSuggests() {
  const box = $('suggests'); box.innerHTML = '';
  const words = predictAdaptive(state.sentence, 5, store);
  words.forEach((w) => {
    const b = document.createElement('button');
    b.className = 'target'; b.dataset.sugg = w;
    b.innerHTML = `<span class="kind" aria-hidden="true">✦</span>${escapeHtml(w)}`;
    box.appendChild(b);
  });
  if (state.board === 'keyboard') refreshScanLayout();
}
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ============================ speech ============================
function loadVoices() {
  try {
    voices = speechSynthesis.getVoices() || [];
    if (state.settings.voiceURI) {
      const i = voices.findIndex((v) => v.voiceURI === state.settings.voiceURI);
      if (i >= 0) voiceIndex = i;
    }
    renderVoiceName();
  } catch { voices = []; }
}
function renderVoiceName() {
  const el = $('voiceName');
  if (el) el.textContent = voiceIndex >= 0 && voices[voiceIndex] ? voices[voiceIndex].name : 'System default';
}
function speak(text) {
  if (!state.settings.voiceOn || !text.trim()) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = state.settings.rate; u.pitch = state.settings.pitch;
    if (voiceIndex >= 0 && voices[voiceIndex]) u.voice = voices[voiceIndex];
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch {}
}
function speakPhrase(text) {
  flashSay(text); speak(text);
  text.split(/\s+/).forEach((w) => store.learnWord(w));
  store.pushHistory(text); renderHistory();
}
function flashSay(text) {
  const box = $('sayText');
  box.innerHTML = escapeHtml(text) + '<span class="caret" aria-hidden="true"></span>';
  box.scrollLeft = box.scrollWidth;
  setTimeout(renderSentence, 1400);
}
function speakSentence() {
  const s = state.sentence.trim();
  if (!s) return;
  speak(s);
  s.split(/\s+/).forEach((w) => store.learnWord(w));
  store.pushHistory(s); renderHistory();
}

// ============================ controls ============================
function handleControl(el) {
  switch (el.id) {
    case 'btnSpeak': return speakSentence();
    case 'btnClear': state.sentence = ''; renderSentence(); renderSuggests(); return;
    case 'btnBack': return backspaceWord();
    case 'btnBoard': return switchView('board');
    case 'btnSettings': return switchView('settings');
    case 'btnRecalib': return startCalibration();
    case 'btnHome': return goHome();
    case 'btnStop': return togglePause();
    case 'scanSelect': return scanSelect();
    case 'voicePrev': return cycleVoice(-1);
    case 'voiceNext': return cycleVoice(1);
    case 'voiceTest': return speak('This is how I will sound.');
    case 'tglBlink': return toggle('blinkOn', el);
    case 'tglVoice': return toggle('voiceOn', el, () => state.settings.voiceOn && speak('Voice on'));
    case 'tglGestures': return toggle('gesturesOn', el);
    case 'tglScan': return toggleScan(el);
    case 'tutNext': return tutNext();
    case 'calibSkip': return cancelCalibration();
  }
}
function toggle(key, el, after) {
  state.settings[key] = !state.settings[key];
  el.textContent = state.settings[key] ? 'On' : 'Off';
  el.classList.toggle('active', state.settings[key]);
  store.saveSettings({ [key]: state.settings[key] });
  if (after) after();
}
function toggleScan(el) {
  state.settings.scanMode = !state.settings.scanMode;
  el.textContent = state.settings.scanMode ? 'On' : 'Off';
  el.classList.toggle('active', state.settings.scanMode);
  store.saveSettings({ scanMode: state.settings.scanMode });
  $('scanSelect').style.display = state.settings.scanMode ? '' : 'none';
  if (state.settings.scanMode) { scanner.enable(performance.now()); refreshScanLayout(); }
  else { scanner.disable(); clearScanHighlight(); }
}
function nudgeRange(el) {
  const step = (parseFloat(el.max) - parseFloat(el.min)) / 10;
  let v = parseFloat(el.value) + step;
  if (v > parseFloat(el.max)) v = parseFloat(el.min);
  el.value = String(v); el.dispatchEvent(new Event('input'));
}
function switchView(v) {
  state.view = v;
  $('boardView').style.display = v === 'board' ? '' : 'none';
  $('settingsView').style.display = v === 'settings' ? '' : 'none';
  $('btnBoard').classList.toggle('active', v === 'board');
  $('btnSettings').classList.toggle('active', v === 'settings');
  refreshScanLayout();
}
// Leave the active mode and return to the start (mode-select) screen. This is
// the app's "back" route: it fully tears down camera/demo so the user can switch
// between them (or reach the Back-to-site link) without reloading the page.
function goHome() {
  // stop calibration cleanly first; keep scan ENABLED (just clear the highlight)
  // so it resumes correctly when the user re-enters a mode.
  if (state.calibrating) cancelCalibration();
  if (state.settings.scanMode) clearScanHighlight();

  // release the current signal source (keep any fitted calibration for next time)
  if (state.mode === 'camera') { try { tracker.stop(); } catch {} }
  demo = null;                       // loopDemo sees mode !== 'demo' and stops
  state.mode = null;
  state.running = false;

  // reset transient pointer/dwell UI
  dwell.reset(); setRing(0); setHot(null);
  cursorEl.classList.add('hidden');
  showEdgeHint(0);

  // tidy chrome
  document.body.classList.remove('cam-on');
  $('camPreview').classList.add('hidden');
  $('hud').setAttribute('aria-hidden', 'true');
  $('btnStop').textContent = 'Pause';
  $('btnStop').classList.remove('primary');
  switchView('board');               // land back on the board next time in

  setStatus('Choose how to start');
  showOverlay('start');
}
function togglePause() {
  state.running = !state.running;
  const btn = $('btnStop');
  btn.textContent = state.running ? 'Pause' : 'Resume';
  btn.classList.toggle('primary', !state.running);   // Resume reads as the way back
  // Keep the cursor VISIBLE while paused: handleSignal restricts activation to
  // this button (see activationScope), so a hands-free user can always dwell
  // Resume. (Previously we hid the cursor AND never gated the pipeline, so Pause
  // did nothing in camera mode and dead-ended hands-free users in demo mode.)
  if (state.running) {
    setStatus(state.mode === 'demo' ? 'demo' : 'live');
  } else {
    dwell.reset(); setRing(0); setHot(null);
    setStatus('paused');
  }
}
function cycleVoice(dir) {
  if (!voices.length) return;
  voiceIndex = (voiceIndex + dir + voices.length) % voices.length;
  renderVoiceName();
  store.saveSettings({ voiceURI: voices[voiceIndex] ? voices[voiceIndex].voiceURI : null });
  speak('Hello');
}

// ============================ switch-scanning ============================
let scanCells = [];  // 2D array of DOM elements matching scanner layout
function activeBoardRows() {
  // rows the scanner steps through, depending on the current view/board
  if (state.view === 'settings') {
    return [Array.from(document.querySelectorAll('#settingsView .target'))];
  }
  const rows = [];
  rows.push(Array.from(document.querySelectorAll('#cats .cat')));
  if (state.board === 'keyboard') {
    rows.push(Array.from(document.querySelectorAll('#suggests .target')).filter(Boolean));
    document.querySelectorAll('#keyboard .row').forEach((r) => rows.push(Array.from(r.querySelectorAll('.key'))));
  } else {
    const cells = Array.from(document.querySelectorAll('#phraseGrid .phrase'));
    for (let i = 0; i < cells.length; i += 4) rows.push(cells.slice(i, i + 4));
  }
  rows.push(Array.from(document.querySelectorAll('.say-bar .target')));
  return rows.filter((r) => r.length);
}
function refreshScanLayout() {
  if (!state.settings.scanMode) return;
  scanCells = activeBoardRows();
  scanner.setLayout(scanCells.map((r) => r.length));
  clearScanHighlight();
}
function clearScanHighlight() {
  document.querySelectorAll('.scan-row, .scan-cell').forEach((n) => n.classList.remove('scan-row', 'scan-cell'));
}
function renderScanHighlight() {
  clearScanHighlight();
  const h = scanner.getHighlight();
  if (!h.active || !scanCells.length) return;
  if (h.level === 'row') {
    (scanCells[h.row] || []).forEach((n) => n.classList.add('scan-row'));
  } else {
    const cell = (scanCells[h.row] || [])[h.col];
    if (cell) cell.classList.add('scan-cell');
  }
}
function scanSelect() {
  const pick = scanner.select(performance.now());
  if (pick) {
    const cell = (scanCells[pick.row] || [])[pick.col];
    if (cell) activate(cell);
    refreshScanLayout();
  }
}

// ============================ status + HUD ============================
function setStatus(kind) {
  const chip = $('statusChip'), txt = $('statusText');
  chip.classList.remove('live', 'demo');
  if (kind === 'live') { chip.classList.add('live'); txt.textContent = 'Tracking'; }
  else if (kind === 'demo') { chip.classList.add('demo'); txt.textContent = 'Demo mode'; }
  else if (kind === 'searching') { txt.textContent = 'Looking for your face…'; }
  else if (kind === 'paused') { txt.textContent = 'Paused — rest on Resume'; }
  else txt.textContent = kind;
}
function updateTrackDot(fx, fy) {
  const dot = $('trackDot');
  dot.style.left = (fx * 100) + '%';
  dot.style.top = (fy * 100) + '%';
}
let lastFpsT = performance.now(), frames = 0, fps = 0;
function updateHud() {
  frames++;
  const now = performance.now();
  if (now - lastFpsT >= 500) {
    fps = Math.round((frames * 1000) / (now - lastFpsT));
    frames = 0; lastFpsT = now;
    $('hudFps').textContent = fps;
    const q = state.mode === 'demo' ? 'demo'
      : (now - state.lastOkTime < 250 ? 'good' : now - state.lastOkTime < 1500 ? 'weak' : 'lost');
    const qEl = $('hudQuality');
    qEl.textContent = q; qEl.className = 'q-' + q;
  }
}

// ============================ calibration (9-point) ============================
let calibPts = [], calibIdx = 0, calibSamples = [], calibHoldStart = 0, calibCollecting = false;
function startCalibration() {
  if (state.mode !== 'camera') { showTutorialIfNeeded(); return; } // demo needs none
  state.calibrating = true;
  calibPts = targets9(); calibIdx = 0; calibSamples = [];
  $('calibOverlay').classList.remove('hidden');
  $('calibTarget').classList.remove('hidden');
  positionCalibTarget();
  setStatus('Calibrating…');
}
function positionCalibTarget() {
  const p = calibPts[calibIdx];
  const x = p.fx * window.innerWidth, y = p.fy * window.innerHeight;
  const tgt = $('calibTarget');
  tgt.style.left = x + 'px'; tgt.style.top = y + 'px';
  $('calibCount').textContent = `${calibIdx + 1} / ${calibPts.length}`;
  calibCollecting = false; calibHoldStart = 0;
  $('calibRing').style.setProperty('--p', '0');
  setTimeout(() => { calibCollecting = true; calibHoldStart = performance.now(); }, 500); // settle time
}
function feedCalibration(fx, fy) {
  if (!calibCollecting) return;
  const p = calibPts[calibIdx];
  const now = performance.now();
  const held = now - calibHoldStart;
  const prog = Math.min(1, held / 1100);
  $('calibRing').style.setProperty('--p', String(prog));
  calibSamples.push({ nx: fx, ny: fy, sx: p.fx * window.innerWidth, sy: p.fy * window.innerHeight, i: calibIdx });
  if (prog >= 1) {
    calibIdx++;
    if (calibIdx >= calibPts.length) finishCalibration();
    else positionCalibTarget();
  }
}
function finishCalibration() {
  // average the samples per target, then fit affine
  const byIdx = {};
  for (const s of calibSamples) {
    (byIdx[s.i] = byIdx[s.i] || []).push(s);
  }
  const pts = Object.values(byIdx).map((arr) => {
    const n = arr.length;
    return {
      nx: arr.reduce((a, b) => a + b.nx, 0) / n,
      ny: arr.reduce((a, b) => a + b.ny, 0) / n,
      sx: arr[0].sx, sy: arr[0].sy,
    };
  });
  const model = fitAffine(pts);
  if (model && rmsError(model, pts, window.innerWidth, window.innerHeight) < window.innerWidth * 0.25) {
    state.affine = model;
    store.saveCalibration(model);
  } else {
    // fit poor — fall back to single-point centering on the center sample
    const center = pts[Math.floor(pts.length / 2)];
    if (center) mapper.calibrate(center.nx, center.ny);
    state.affine = null;
  }
  endCalibrationUI();
  showTutorialIfNeeded();
}
function cancelCalibration() { state.calibrating = false; endCalibrationUI(); }
function endCalibrationUI() {
  state.calibrating = false;
  $('calibOverlay').classList.add('hidden');
  $('calibTarget').classList.add('hidden');
  setStatus('live');
}

// ============================ tutorial ============================
const TUT = [
  { t: 'Move', b: 'Turn your head and the pointer follows. Small, calm movements work best.' },
  { t: 'Hold to click', b: 'Rest the pointer on a button. A ring fills — when it completes, Glide clicks. A long blink works too.' },
  { t: 'Speak', b: 'Type or pick a phrase, then rest on Speak to say it aloud. Glide learns the words you use most.' },
];
let tutStep = 0;
function showTutorialIfNeeded() {
  if (state.settings.tutorialSeen) return;
  tutStep = 0; renderTut();
  $('tutOverlay').classList.remove('hidden');
  setTimeout(() => { try { $('tutNext').focus(); } catch {} }, 0);
}
function renderTut() {
  const s = TUT[tutStep];
  $('tutTitle').textContent = s.t;
  $('tutBody').textContent = s.b;
  $('tutNext').textContent = tutStep === TUT.length - 1 ? 'Start using Glide' : 'Next';
  const dots = $('tutDots'); dots.innerHTML = '';
  TUT.forEach((_, i) => { const d = document.createElement('span'); d.className = 'dot' + (i === tutStep ? ' on' : ''); dots.appendChild(d); });
}
function tutNext() {
  tutStep++;
  if (tutStep >= TUT.length) {
    $('tutOverlay').classList.add('hidden');
    state.settings.tutorialSeen = true; store.saveSettings({ tutorialSeen: true });
  } else renderTut();
}

// ============================ history ============================
function renderHistory() {
  const box = $('history'); if (!box) return;
  const items = store.getHistory();
  if (!items.length) { box.innerHTML = '<span class="hint">Sentences you speak will appear here.</span>'; return; }
  box.innerHTML = '';
  items.slice(0, 8).forEach((h) => {
    const b = document.createElement('button');
    b.className = 'target hist-item'; b.dataset.hist = h.text; b.textContent = h.text;
    box.appendChild(b);
  });
}

// ============================ boot: camera vs demo ============================
async function startCamera() {
  showOverlay('load');
  try {
    tracker.onSignal(handleSignal);
    await tracker.init((m) => { $('loadMsg').textContent = m; });
    await tracker.start($('video'));
    state.mode = 'camera'; state.running = true;
    $('camPreview').classList.remove('hidden');
    document.body.classList.add('cam-on');   // reserve room under the corner preview
    $('hud').setAttribute('aria-hidden', 'false');
    hideOverlays();
    // reuse a saved calibration if present, else run calibration
    const saved = store.getCalibration();
    if (saved) { state.affine = saved; showTutorialIfNeeded(); }
    else startCalibration();
  } catch (e) {
    console.error(e);
    $('errMsg').textContent = friendlyError(e);
    showOverlay('err');
  }
}
function friendlyError(e) {
  const msg = (e && e.message) || '';
  if (/Permission|NotAllowed/i.test(msg)) return 'Camera permission was blocked. You can allow it and retry, or explore the full demo.';
  if (/NotFound|Requested device/i.test(msg)) return 'No camera was found on this device. The demo shows everything without one.';
  if (/import|fetch|network|Failed to fetch/i.test(msg)) return 'Could not load the face model (no internet?). The demo works fully offline once cached.';
  return 'Something blocked the camera. You can still explore everything in demo mode.';
}

const DEMO_TARGETS = [
  { x: 0.30, y: 0.30, hold: 1300 },
  { x: 0.20, y: 0.54, hold: 1300 },
  { x: 0.46, y: 0.54, hold: 1300 },
  { x: 0.74, y: 0.54, hold: 1300 },
  { x: 0.36, y: 0.83, hold: 1500 },
  { x: 0.83, y: 0.145, hold: 1300 },
  { x: 0.62, y: 0.05, hold: 1200 },
];
function startDemo() {
  state.mode = 'demo'; state.running = true;
  demo = new DemoDriver(DEMO_TARGETS.map((t) => ({ x: t.x, y: t.y, hold: t.hold })), { travelMs: 1150 });
  $('camPreview').classList.add('hidden');
  document.body.classList.remove('cam-on');   // no preview in demo, no reserved gap
  $('hud').setAttribute('aria-hidden', 'false');
  hideOverlays();
  setStatus('demo');
  showTutorialIfNeeded();
  loopDemo();
}
function loopDemo() {
  if (state.mode !== 'demo') return;
  // freeze the demo driver while an overlay is up (e.g. the tutorial) so the
  // scripted pointer can't drift onto and self-activate the overlay's buttons.
  if (state.running && !state.calibrating && !openOverlay()) {
    const now = performance.now();
    const s = demo.sample(now);
    driveCursorTo(s.x * window.innerWidth, s.y * window.innerHeight, now);
    setStatus('demo');
  }
  requestAnimationFrame(loopDemo);
}

// ============================ overlays ============================
function showOverlay(which) {
  $('startOverlay').classList.toggle('hidden', which !== 'start');
  $('loadOverlay').classList.toggle('hidden', which !== 'load');
  $('errOverlay').classList.toggle('hidden', which !== 'err');
  // move keyboard focus into the dialog so keyboard/switch users land on the
  // primary action instead of somewhere behind the overlay.
  const primary = { start: 'startCamera', err: 'errDemo' }[which];
  if (primary) setTimeout(() => { try { $(primary).focus(); } catch {} }, 0);
}
function hideOverlays() {
  ['startOverlay', 'loadOverlay', 'errOverlay'].forEach((id) => $(id).classList.add('hidden'));
}

// ============================ master UI loop (scan + HUD) ============================
function uiLoop() {
  const now = performance.now();
  if (state.settings.scanMode && state.running && !state.calibrating) {
    scanner.tick(now);
    renderScanHighlight();
  }
  updateHud();
  requestAnimationFrame(uiLoop);
}

// ============================ settings wiring ============================
function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function applySettingsToUI() {
  const s = state.settings;
  $('sSens').value = s.sensitivity; $('sSensVal').textContent = (+s.sensitivity).toFixed(1);
  $('sDwell').value = s.dwellMs; $('sDwellVal').textContent = (s.dwellMs / 1000).toFixed(2) + 's';
  $('sSmooth').value = s.smoothing; $('sSmoothVal').textContent = (+s.smoothing).toFixed(1);
  $('sScan').value = s.scanSpeedMs; $('sScanVal').textContent = (s.scanSpeedMs / 1000).toFixed(1) + 's';
  $('sRate').value = s.rate; $('sRateVal').textContent = (+s.rate).toFixed(1);
  $('sPitch').value = s.pitch; $('sPitchVal').textContent = (+s.pitch).toFixed(1);
  const setTgl = (id, on) => { const el = $(id); el.textContent = on ? 'On' : 'Off'; el.classList.toggle('active', on); };
  setTgl('tglBlink', s.blinkOn); setTgl('tglVoice', s.voiceOn);
  setTgl('tglGestures', s.gesturesOn); setTgl('tglScan', s.scanMode);
  mapper.setSensitivity(s.sensitivity);
  smoother.setParams({ minCutoff: clamp(2.0 - s.smoothing, 0.3, 2.0), beta: 0.012 });
  dwell = makeDwell(s.dwellMs);
  scanner.setSpeed(s.scanSpeedMs);
  $('scanSelect').style.display = s.scanMode ? '' : 'none';
}
function wireSettings() {
  $('sSens').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value); mapper.setSensitivity(v);
    state.settings.sensitivity = v; $('sSensVal').textContent = v.toFixed(1); store.saveSettings({ sensitivity: v });
  });
  $('sDwell').addEventListener('input', (e) => {
    const ms = parseInt(e.target.value, 10); dwell = makeDwell(ms);
    state.settings.dwellMs = ms; $('sDwellVal').textContent = (ms / 1000).toFixed(2) + 's'; store.saveSettings({ dwellMs: ms });
  });
  $('sSmooth').addEventListener('input', (e) => {
    const k = parseFloat(e.target.value);
    smoother.setParams({ minCutoff: clamp(2.0 - k, 0.3, 2.0), beta: 0.012 });
    state.settings.smoothing = k; $('sSmoothVal').textContent = k.toFixed(1); store.saveSettings({ smoothing: k });
  });
  $('sScan').addEventListener('input', (e) => {
    const ms = parseInt(e.target.value, 10); scanner.setSpeed(ms);
    state.settings.scanSpeedMs = ms; $('sScanVal').textContent = (ms / 1000).toFixed(1) + 's'; store.saveSettings({ scanSpeedMs: ms });
  });
  $('sRate').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value); state.settings.rate = v; $('sRateVal').textContent = v.toFixed(1); store.saveSettings({ rate: v });
  });
  $('sPitch').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value); state.settings.pitch = v; $('sPitchVal').textContent = v.toFixed(1); store.saveSettings({ pitch: v });
  });
}

// mouse fallback so keyboard/mouse users (and testing) can operate everything too
document.addEventListener('click', (e) => {
  const t = e.target.closest && e.target.closest('.target, .key, .phrase, .cat, .hist-item');
  if (t && state.mode) activate(t);
});

// ============================ init ============================
function init() {
  buildCats(); buildKeyboard(); switchBoard('keyboard');
  renderSentence(); renderSuggests(); renderHistory();
  switchView('board'); applySettingsToUI(); wireSettings();

  // restore calibration existence (applied on camera start)
  $('startCamera').addEventListener('click', startCamera);
  $('startDemo').addEventListener('click', startDemo);
  $('errDemo').addEventListener('click', startDemo);
  $('errRetry').addEventListener('click', startCamera);

  if ('speechSynthesis' in window) {
    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
  }

  // Deep link: opening app.html#demo jumps straight into Demo Mode (no camera, so
  // no permission gesture needed). Camera still routes through the start card so
  // the getUserMedia prompt stays tied to an explicit click.
  if ((location.hash || '').toLowerCase() === '#demo') startDemo();
  else showOverlay('start');
  uiLoop();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
init();

// tiny hook for automated smoke checks
window.__glide = { state, startDemo, handleSignal, predictAdaptive, store };
