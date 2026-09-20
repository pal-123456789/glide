# Glide — Pitch Deck (content + speaker notes)

Slide-by-slide content for a ~10-slide hackathon pitch (5–6 min). This is the
finished copy; it's ready to drop into PowerPoint/Slides. (The `.pptx` can be
generated from this once a build environment with the pptx tooling is available —
see the note at the bottom.)

**Design language** (match the app + landing): deep-ink background `#0E1116`,
teal `#38E0C8` for motion/emphasis, amber `#FFB020` for the "commit" accent.
Display type **Bricolage Grotesque**, body **Atkinson Hyperlegible**. High
contrast, few words per slide, one idea each.

---

## Slide 1 — Title

**Glide**
Hands-free computer control from any webcam.

*Subtitle:* A free replacement for the $1,000–$4,000 eye-tracker.
*Footer:* HackDay 1.0 · Tech for a Better Tomorrow

> **Say:** "The webcam in this laptop, turned into an assistive input device."

---

## Slide 2 — The problem (make it human)

**A $2,000 wall between people and their own computers.**

- Dedicated eye-gaze / head-tracking hardware costs **$1,000–$4,000**.
- It's what lets people with **ALS, spinal-cord injury, cerebral palsy, muscular
  dystrophy, severe RSI** use a computer and communicate.
- Insurance coverage is patchy; many simply go without.

> **Say:** "For millions of people, the barrier to using a computer isn't ability
> — it's a price tag."

---

## Slide 3 — The insight

**The hardware is already on the desk.**

Every modern laptop has a camera good enough to track a head 30 times a second.
The expensive part was never the sensor — it was the software. So we wrote the
software.

---

## Slide 4 — What Glide does (the three primitives)

**Move · Hold · Speak**

- **Move** — your head drives the cursor, smoothed so it feels calm, not twitchy.
- **Hold** — rest on a target; a ring fills; it clicks. (Or a long blink.)
- **Speak** — a big-target keyboard + phrase board with prediction reads your
  sentence aloud.

> **Say:** "Three moves. That's the entire interaction model — deliberately
> small, so it fits a wide range of motor abilities."

---

## Slide 5 — Live demo

**(Switch to the app. ~2 min. See DEMO_SCRIPT.md.)**

Fallback if hardware is uncertain: **Demo Mode** drives the real pipeline with no
camera — every feature is visible without a webcam.

> Demo beats: pointer glides → dwell-click → type "i need water" → Speak → swap to
> the **Needs** board → Settings (hands-free scroll, sliders, switch-scanning) →
> Pause/Resume → "runs offline, nothing leaves the device."

---

## Slide 6 — It bends to the person, not the other way around

**One tool, many bodies.**

- Tunable **dwell time, pointer speed, smoothing**.
- **Blink-to-click** and **head-gesture** shortcuts (mouth = speak, brows =
  delete).
- **Switch-scanning** for users with a *single* reliable movement.
- **Hands-free edge-scroll** so no screen content is ever out of reach.

---

## Slide 7 — Private by construction

**No server. No uploads. No accounts.**

- All face detection is **on-device** WebAssembly inference in the browser.
- The camera frame **never leaves the page** — there is literally no backend to
  send it to.
- Installable PWA, **works offline** after first load.

> **Say:** "For a tool pointed at your own face, all day, privacy can't be a
> policy — it has to be the architecture. There's nothing to leak because there's
> nowhere for it to go."

---

## Slide 8 — How it's built (credibility)

**Vanilla JS. Zero runtime dependencies. Static files.**

- MediaPipe FaceLandmarker (WASM) → One-Euro smoothing → 9-point affine
  calibration → dwell/blink/gesture state machines.
- Camera path and Demo Mode feed the **same** pipeline — tested by a
  demo-drives-real-clicks integration test.
- Pure-logic core is unit-tested (`node --test`); ships as an offline PWA.

*Small architecture strip:* `webcam → tracker → filter → calibrate → gestures → DOM`

---

## Slide 9 — Impact & what's next

**Free, today. Ambitious, next.**

- **Today:** full talking keyboard + phrase boards, hands-free, in any modern
  browser, at $0.
- **Next:** OS-level pointer control, multiple saved profiles (bed vs. desk),
  more languages, optional eye-gaze as a second pointer source.

---

## Slide 10 — Close

**The camera you already own, as an assistive device.**

Glide · hands-free · private · free.
*[deployed link] · open-source (MIT)*

> **Say:** "We didn't make a cheaper eye-tracker. We made the one that costs
> nothing and runs on what's already there."

---

### Generating the .pptx

This deck is finished as copy. To render the actual `.pptx`, run the deck build in
an environment with the presentation tooling available (the session's `pptx`
skill), using the design language and slide content above verbatim. The narrative
order and speaker notes are the deliverable; the file is a mechanical render of
this content. Tracked as a follow-up task.
