# Glide — Architecture

This document explains how Glide is put together: the data flow from webcam to
click, why the code is split the way it is, and the design decisions that aren't
obvious from reading any single file. If you're evaluating the project or picking
it up to extend, start here.

Glide is a **static, zero-dependency, offline-first PWA** written in vanilla ES
modules. There is no backend, no build framework, and no runtime package
installs. The only external code it ever loads is the MediaPipe face model, and
that is cached for offline use after the first run.

---

## 1. The core idea

A webcam plus a face-landmark model gives you, every frame, the position and
expression of a head. Glide turns that stream into two things a person who can't
use a mouse and keyboard needs:

1. **A pointer** they can move by turning their head.
2. **A click** they can perform without a finger — by *dwelling* (resting on a
   target until a ring fills) or by a long, deliberate *blink*.

On top of those two primitives sits an on-screen keyboard and a quick-phrase
communication board with text-to-speech, so the same head movements can also
*speak*.

Everything else in the codebase exists to make those primitives reliable, calm,
and reachable for a wide range of motor abilities.

---

## 2. Data flow (one frame)

```
 webcam ─► FaceTracker ─► signal {nx, ny, blinkL/R, jawOpen, browUp, t}
                              │
                              ▼
                        OneEuro2D filter        (smooth the jitter)
                              │
                              ▼
             calibration model (affine)  OR  CursorMapper   (head → screen px)
                              │
                              ▼
                    ┌─────────────────────────┐
                    │   handleSignal (app.js)  │
                    │  gating: paused? overlay?│
                    └─────────────────────────┘
                              │
             ┌────────────────┼───────────────────┐
             ▼                ▼                    ▼
        render cursor    dwell / blink        head gestures
        + trail          → activate(el)       jaw = speak
                         (or edge-scroll)      brow = delete word
```

The exact same pipeline is fed by **Demo Mode**, which swaps the `FaceTracker`
for a scripted `DemoDriver` that emits the same signal shape. Because the demo
drives the *real* pipeline (not a fake overlay), what a judge sees in the demo is
literally the app working — and the integration test asserts this.

---

## 3. Module map

The source of truth is `src/*.js`. Modules split cleanly into **pure logic**
(no DOM, unit-tested with `node --test`) and **browser glue** (DOM/WebGL/camera,
verified by `node --check` + an in-browser checklist).

### Pure logic (tested in Node)

| Module | Responsibility | Key decisions |
|---|---|---|
| `filter.js` | One-Euro 2D smoothing filter + `clamp` | One-Euro (Casiet et al., CHI 2012) adapts cutoff to speed: still head → heavy smoothing (no jitter), fast head → light smoothing (no lag). Tuned via a single "smoothing" slider mapped to `minCutoff`. |
| `cursor.js` | `CursorMapper`: head-normalized → screen px | Dead-zone (ignore micro-tremor near center), sensitivity gain, X mirroring (so moving your head right moves the cursor right), edge handling. Used as the fallback when there is no calibration. |
| `gestures.js` | `DwellClicker`, `BlinkClicker`, `ExpressionTrigger` | Each is a small state machine with a **refractory period** so one action can't machine-gun. Dwell uses a move-tolerance so a slightly shaky hold still counts. |
| `predict.js` + `lexicon.js` | Adaptive n-gram word prediction | Seeded from a base lexicon, then **learns the user's own words** (persisted). Prediction is offline and instant. |
| `demopath.js` | `DemoDriver`: scripted "virtual head" | Emits the same signal contract as the tracker so Demo Mode exercises the real pipeline. |
| `calibrate.js` | 9-point affine solver (least squares) | Fits `screen = A·head + b` by normal equations solved with Cramer's rule. Corrects skew/scale/offset that single-point centering can't. Degenerate fits return `null` → app falls back to the mapper (never a broken pointer). |
| `scanning.js` | `ScanController`: switch-scanning | Row-then-cell auto-stepping for users with a *single* reliable movement. One "switch" (blink or dwell on a SELECT bar) picks the highlighted row, then the cell. |
| `store.js` | `localStorage` persistence | Settings, calibration model, learned words, sentence history — all local, all private. |

### Browser glue (checked, not unit-tested)

| Module | Responsibility |
|---|---|
| `tracker.js` | Wraps MediaPipe FaceLandmarker (WASM). Owns the camera stream, converts landmarks/blendshapes into the signal contract. This is the *only* module that touches the camera. |
| `app.js` | The controller. Wires the signal source through the core into the DOM: cursor + dwell ring, boards, prediction, TTS, calibration, scanning, HUD, tutorial, and the input-gating rules (pause / overlay / edge-scroll). |
| `hero3d.js` | The landing page's scroll-driven 3D face-mesh hero (Three.js). Owns the scene, exposes `setScroll`/`setPointer`; degrades to a static hero if WebGL is unavailable or reduced-motion is set. |
| `scroll.js` | The landing page's scroll director: native `position:sticky` pin (no GSAP), drives the hero scrub + caption cross-fade + section reveals. |

### The signal contract

Everything downstream depends on one small object shape, emitted per frame by
either source:

```js
{
  ok: true,        // false when no face is found this frame
  nx, ny,          // head position, normalized 0..1 (nx already un-mirrored)
  blinkL, blinkR,  // eye-closed blendshape scores 0..1 (camera only)
  jawOpen, browUp, // expression scores 0..1 (camera only)
  t                // timestamp (ms)
}
```

Keeping this contract tiny and identical across the camera and demo sources is
what lets one pipeline serve both.

---

## 4. Input gating — the rules that keep clicks safe

A head-pointer is "always on": the cursor is wherever the head points, every
frame. That makes a few states subtle, and `app.js` centralizes them in
`activationScope()`:

- **Normal:** the pointer can activate anything.
- **Paused:** only the Resume control is live. The cursor stays *visible* (so a
  hands-free user can steer to Resume), but dwell/blink can't fire clicks
  anywhere else. (Before this rule, Pause hid the cursor yet left the pipeline
  running — clicks kept landing.)
- **Overlay open (tutorial/error/etc.):** only that overlay's own buttons are
  live, so a moving pointer can't click the board *behind* the overlay, and the
  demo driver can't self-advance the tutorial. The cursor renders **above** the
  overlay (z-index) so it's visible on the card.
- **Calibrating:** the signal is routed to the calibration sampler instead of
  the cursor; a long blink is an escape hatch so a user who can't hold a point is
  never trapped.

### Hands-free edge-scroll

Some views (Settings, or the board on a short/zoomed viewport) are taller than
the stage. A mouse user scrolls; a hands-free user has no wheel. So when the
cursor **rests near the top/bottom edge** of the active scroll container, Glide
auto-scrolls after a short *arm* delay (so merely passing through the band
doesn't scroll), shows a pill affordance, and suppresses the dwell-click while
scrolling so a control in the edge band can't fire by accident.

---

## 5. Offline & PWA

`sw.js` is a service worker with two strategies:

- **App shell** (our own files): *cache-first*, so Glide opens instantly and
  works with no network.
- **CDN assets** (MediaPipe model/wasm, fonts): *stale-while-revalidate*, so the
  first online load populates the cache and every load after works offline.

The camera stream is never touched by the service worker — it never leaves the
page. Cache keys are versioned (`glide-shell-vN`); bumping the version on
release evicts the old shell on the next activate.

---

## 6. The `file://` problem and the bundler

Browsers block ES-module `import` over the `file://` protocol. Double-clicking
`app.html` would otherwise leave every button dead (CSS still loads, which is
misleading). Two mitigations:

1. **`build.js`** — a ~100-line, dependency-free bundler. It wraps each module in
   a tiny runtime registry (`__glideDef` / `__glideReq`) and rewrites
   `import`/`export` into registry calls, emitting `dist/app.bundle.js` and
   `dist/landing.bundle.js` as ordinary classic scripts that run over `file://`,
   `http://`, and GitHub Pages alike. The dynamic `import()` for the MediaPipe
   CDN is left untouched.
2. **Serving over http** (`serve.js` / `serve.ps1` / `serve.sh`) sidesteps it
   entirely, as does GitHub Pages (https).

**The bundles are generated artifacts.** `src/*.js` is the source of truth
(the tests import it directly). After editing any `src` file, run `node build.js`
(or `verify.sh` / `verify.ps1`) to regenerate the committed bundles.

---

## 7. Landing page: the sticky scroll-film

The hero is a Three.js point-cloud face that scrubs through a Move → Hold →
Speak story as you scroll, then releases so the brand page scrolls up over it.
Two decisions worth calling out:

- **No GSAP.** `ScrollTrigger.pin` silently fails when an ancestor is a scroll
  container, and `overflow-x:hidden` + `scroll-behavior:smooth` both create one.
  The pin is done with native CSS `position:sticky` instead (which can't fail
  that way), and `scroll.js` computes progress from the track geometry. Use
  `overflow-x:clip`, **not** `hidden`, so the sticky survives.
- **Normal, not additive, blending** for the dense point cloud. Many overlapping
  additive sprites with white cores sum to white — the whole hero washed out to a
  flat mint colour. The face cloud uses `NormalBlending` with a non-white teal
  core; additive is reserved for sparse accents (cursor halo, ring fills).

---

## 8. Testing & verification

```bash
node --test      # full unit + integration suite (pure-logic modules)
node --check <f> # syntax-check browser-glue modules that can't be unit-tested
```

- **Pure-logic modules** are covered directly: the filter, cursor mapping, every
  gesture detector, word prediction, the calibration solver, switch-scanning, and
  a **demo-drives-real-clicks** integration test.
- **Browser glue** (camera/DOM/WebGL) can't run in Node; it's syntax-checked and
  validated against an in-browser checklist. There is no headless WebGL/camera in
  CI, by design — the pipeline it feeds is what's tested.

`verify.sh` / `verify.ps1` run build + check + test in one command;
`.github/workflows/pages.yml` runs the same gate on every push before deploying.

---

## 9. Accessibility posture

Glide *is* an accessibility tool, so the app UI holds itself to the same bar:

- Large targets, high-contrast dark theme, visible `:focus-visible` rings.
- **Atkinson Hyperlegible** body type (Braille Institute), designed for low
  vision.
- `prefers-reduced-motion` honored (the 3D hero and trails disable themselves).
- Every scrollable view is reachable both by mouse (scroll floor) and hands-free
  (edge-scroll), so no content is ever trapped off-screen.
- Multiple redundant input paths — dwell, blink, head gestures, and
  switch-scanning — so the app fits a range of motor abilities rather than
  assuming one.

Full WCAG conformance would still require manual testing with assistive
technologies and expert review; the above is the built-in floor, not a
certification.
