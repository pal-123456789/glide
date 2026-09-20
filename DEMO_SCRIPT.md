# Glide — Live Demo Script (≈3–4 min)

A tight, judge-facing runbook. Every beat below maps to a feature that's actually
in the shipped build, so nothing here can "no-op" on stage. Two paths are given:
**Demo Mode** (bulletproof, no camera/permissions needed — use this if the room
or laptop is uncertain) and the **Camera** path (the real thing — use it if you
have good lighting and a working webcam).

> Setup before you present: serve over http (`serve.ps1` / `serve.sh`) or open the
> deployed Pages link. Have `http://localhost:8080/` (landing) ready in one tab.
> If using the camera, grant the permission once beforehand so there's no prompt
> mid-demo. Clear prior state if you want the first-run tutorial to show (fresh
> profile / private window).

---

## 0. The hook (15s) — say this over the landing hero

> "Eye-gaze devices that let people with ALS or spinal-cord injuries use a
> computer cost **one to four thousand dollars**. The webcam in this laptop can do
> the core of that job — it just needed the software. This is Glide."

Scroll the landing page once, slowly: the 3D face-mesh scrubs through **Move →
Hold → Speak**. That's the whole product in one scroll. Then click **Launch
Glide**.

## 1. Enter (10s)

The start card appears: *"Move the pointer with your head. Rest to click. Speak
with a tap."*

- **Judges' room, uncertain hardware →** click **"Watch the demo (no camera)."**
- **Confident setup →** click **"Start with my camera."** (then do §2b)

## 2a. Demo Mode — the pointer is real (30s)

A scripted "virtual head" now drives the **real** pipeline (not a video). Narrate:

> "I'm not touching the mouse. This pointer is being driven exactly the way a
> head would drive it — same code path."

Watch the cursor glide to a key, the **amber ring fills**, and it **clicks**. Point
out the ring: *"That's dwell — resting to click. No button press anywhere."*

## 2b. Camera path (30s) — if you chose the camera

- First run shows a 3-step **tutorial** (Move / Hold / Speak). Rest on **Next** to
  advance it hands-free, or click it.
- **Calibration** runs 9 points — look at each amber dot and hold. Say: *"This
  fits the pointer to my range of motion — like a real eye-tracker."* (If tracking
  is rough, a **long blink** skips it.)
- Now move your head; the cursor follows, smoothed so it's calm, not twitchy.

## 3. Speak a sentence (40s)

Dwell out a short phrase on the keyboard — e.g. **"i need water"**.

- Point out **word suggestions** appearing above the keyboard: *"It predicts, and
  it learns the words this person actually uses."*
- Dwell **Speak** → the browser reads it aloud. *"That's their voice back."*
- Note the say-bar keeps the newest text and caret in view as it grows.

## 4. Quick-phrase boards (20s)

Dwell a category tab — **Needs** or **Feelings**. The grid swaps to big one-tap
phrases (**"I need help"**, **"I'm in pain"** in urgent red).

> "For someone in distress, hunting for letters is the wrong ask. One rest, one
> sentence, spoken."

## 5. It bends to the person (40s)

Open **Settings** (topbar). This is the accessibility story:

- **Scroll it hands-free:** rest the cursor at the bottom edge — a **"▼ scroll
  down"** pill appears and the panel scrolls. *"No content is ever trapped
  off-screen, even with no hands."*
- **Dwell time / pointer speed / smoothing** sliders — *"tune it to any range of
  motion."*
- **Blink to click**, **Head gestures** (open mouth = speak, brows up = delete
  word), **Voice** picker + rate/pitch.
- Flip on **Switch-scanning** and show the highlight stepping row→cell: *"For
  someone with a **single** reliable movement — one blink selects."*

## 6. Trust + resilience (20s)

- **Pause** (topbar): input stops immediately — *"and it genuinely stops; the
  pointer can't click anything but Resume."* Rest on **Resume** to come back.
- **Privacy:** *"Every frame is processed on-device. There is no server. Nothing
  is uploaded."* (Optional flex: turn off Wi-Fi and reload — it still works; it's
  an offline PWA.)

## 7. Close (15s)

> "Free, private, works on hardware people already own, and installs like an app.
> The camera you already have, as an assistive device. That's Glide."

---

## If something goes wrong (stay calm)

- **Camera won't start / bad lighting** → the error card offers **"Watch the demo
  instead."** Take it; the demo shows every feature.
- **Tracking drifts** → open Settings, raise **Smoothing**, or hit **Recalibrate**
  in the topbar.
- **Pointer feels slow/fast** → **Pointer speed** slider.
- **Nothing responds** → check the status chip (top-left): "Looking for your
  face…" means it lost you; re-center in frame.

## One-line pitch (memorize)

> **Glide turns any webcam into a $2,000 eye-tracker — hands-free cursor, dwell
> clicks, and a talking keyboard — 100% on-device and free.**
