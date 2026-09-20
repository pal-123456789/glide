# Glide — hands-free computer control from any webcam

**Move the pointer with your head. Click by resting on a button. Speak with a tap.**
Glide turns the webcam you already own into an assistive input device, so people who
can't use a mouse and keyboard can operate a computer and communicate — for free,
entirely on-device.

> Built for **HackDay 1.0** (DECODEP) · Theme: *Tech for a Better Tomorrow* · 8-hour build.

---

## The problem

Dedicated eye-gaze and head-tracking hardware (Tobii and similar) costs **$1,000–$4,000**
and isn't covered everywhere. That price wall locks millions of people with ALS,
spinal-cord injury, cerebral palsy, muscular dystrophy, or severe RSI out of the
device most of us take for granted. Yet the camera in nearly every laptop can already
do the core of the job — it just needed the software.

## The solution

Glide runs a face-landmark model **locally in the browser** and turns your head into a
pointer:

- **Move** — head position drives the cursor, smoothed by a One-Euro filter so it feels calm, not twitchy.
- **Hold (dwell-click)** — rest on a target and a ring fills; when it completes, Glide clicks. A long, deliberate **blink** is an optional second way to click.
- **Speak** — a large-target on-screen keyboard + quick-phrase board with offline word prediction builds a sentence and reads it aloud with text-to-speech.

It's a installable PWA that works **offline after first load**, and the **camera feed never leaves the device** — no uploads, no accounts, no tracking.

## Try it

- **Live:** _add your deployed link here_
- **Landing page:** `index.html`
- **App:** `app.html`

No webcam, or on a locked-down machine? Click **"Watch the demo"** — a scripted driver
operates the whole app hands-free so every feature is visible without a camera.

## Run locally

**Fastest:** double-click `index.html`. The app ships a bundled classic script
(`dist/*.bundle.js`) specifically so it runs when opened directly over `file://`.

**Recommended (matches production):** serve it over `http://`. A one-liner is included:

```bash
# Windows
powershell -ExecutionPolicy Bypass -File .\serve.ps1
# macOS / Linux / WSL
bash serve.sh
# (both auto-detect Python or Node; or run any static server yourself)
```

Then open `http://localhost:8080/`, click **Launch Glide**, then **Start with my
camera** (allow the camera prompt) or **Watch the demo**.

> **Why serve over http?** The source is ES modules (`import`/`export`), and browsers
> block module `import` over the `file://` protocol for security. Opening the raw file
> would leave the buttons dead. The committed bundles sidestep that; the server avoids
> it entirely. GitHub Pages serves over `https`, so the deployed site needs neither.

## Build

The ES-module sources in `src/` are the source of truth. After editing any of them,
regenerate the browser bundles:

```bash
node build.js     # writes dist/app.bundle.js and dist/landing.bundle.js
```

`build.js` is a tiny dependency-free bundler: it wraps each module in a runtime
registry and rewrites `import`/`export` into registry calls, leaving the one dynamic
`import()` (the MediaPipe CDN load) untouched.

## Deploy (GitHub Pages)

Glide is a static site, so hosting it is just pushing the folder. A one-command
helper builds, tests, commits, and pushes:

```bash
bash deploy.sh      # macOS / Linux / WSL
# or, on Windows:
powershell -ExecutionPolicy Bypass -File .\deploy.ps1
```

Then, one time on GitHub: **Settings → Pages → Build and deployment → Source:
"GitHub Actions"**. The included workflow (`.github/workflows/pages.yml`) rebuilds
the bundles, runs the tests as a gate, and publishes on every push to the default
branch. The deploy scripts never force-push or rewrite history and don't change
your global git config.

### Vercel

`vercel.json` is included, so Glide deploys to Vercel with no extra config. Either
connect the GitHub repo in the Vercel dashboard (recommended — it redeploys on
every push), or from the project folder:

```bash
npx vercel --prod
```

Vercel runs `node build.js` (the `buildCommand` in `vercel.json`) to regenerate the
bundles, serves the repo root, uses clean URLs (`/app` → `app.html`), and sends the
service worker with a no-cache header so updates roll out immediately.

## How it's built

Vanilla JS, no framework, no runtime dependencies — the whole thing is static
files. (A tiny in-repo bundler, `build.js`, repackages the ES modules so they
also run over `file://`; see [ARCHITECTURE.md](ARCHITECTURE.md) for the full design.)

| Layer | File | Notes |
|---|---|---|
| Face tracking | `src/tracker.js` | MediaPipe FaceLandmarker (WASM), loaded from CDN, cached for offline |
| Smoothing | `src/filter.js` | One-Euro filter (Casiet et al., CHI 2012) |
| Cursor mapping | `src/cursor.js` | dead-zone, sensitivity, edge-acceleration, mirror |
| Gestures | `src/gestures.js` | dwell-click, deliberate-blink, expression triggers |
| Speech board | `src/predict.js`, `src/lexicon.js` | offline n-gram word prediction |
| Calibration | `src/calibrate.js` | 9-point affine solver (least squares), falls back safely |
| Switch-scanning | `src/scanning.js` | row→cell auto-stepping for single-switch users |
| Demo Mode | `src/demopath.js` | scripted "virtual head" so the app self-demos |
| Controller | `src/app.js` | wires signal source → core → DOM; input gating, edge-scroll |
| Offline | `sw.js`, `manifest.webmanifest` | PWA app-shell + runtime caching |

The camera/MediaPipe code is isolated in one module; everything else is browser-free
and unit-tested. Camera path and Demo Mode feed the **same** pipeline, so behavior is identical.

## Tests

```bash
node --test
```

The suite covers the smoothing filter, cursor mapping, all gesture detectors, the
9-point calibration solver, word prediction, switch-scanning, the demo path, and a
demo-drives-real-clicks integration check — every pure-logic module. Browser glue
(camera/DOM/WebGL) is syntax-checked and validated in-browser.

`verify.sh` / `verify.ps1` run build + syntax-check + tests in one command:

```bash
bash verify.sh      # macOS / Linux / WSL
# or, on Windows:
powershell -ExecutionPolicy Bypass -File .\verify.ps1
```

## Privacy

All face detection is local WebAssembly inference in your browser. No video frame is
ever sent anywhere; there is no backend. Works offline once the model is cached.

## Accessibility

Large targets, high-contrast dark theme, visible keyboard focus, `prefers-reduced-motion`
respected, and the body typeface is **Atkinson Hyperlegible** (Braille Institute),
designed for low-vision readability.

## Roadmap

- On-screen full-OS control via the browser's experimental pointer APIs / a companion helper
- Multiple named calibration + gesture profiles (e.g. bed vs. desk) saved locally
- More languages for the speech board and prediction
- Eye-gaze estimation as an optional pointer source alongside head pose

## License

MIT — see `LICENSE`.
